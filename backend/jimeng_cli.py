import asyncio
import json
import os
import shutil
import subprocess
import time
import uuid
from urllib.parse import quote
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, Optional


class JimengCliError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        failure_category: Optional[str] = None,
        failure_title: Optional[str] = None,
        failure_reason: Optional[str] = None,
        failure_detail: Optional[str] = None,
        failure_submit_id: Optional[str] = None,
        failure_log_id: Optional[str] = None,
    ):
        super().__init__(message)
        self.failure_category = failure_category
        self.failure_title = failure_title
        self.failure_reason = failure_reason
        self.failure_detail = failure_detail
        self.failure_submit_id = failure_submit_id
        self.failure_log_id = failure_log_id


@dataclass
class JimengCliResult:
    video_url: str
    files: list[str]
    account_id: Optional[str] = None
    account_alias: Optional[str] = None


@dataclass
class JimengFailureDetails:
    category: str
    title: str
    detail: str
    reason: Optional[str] = None
    submit_id: Optional[str] = None
    log_id: Optional[str] = None


@dataclass(frozen=True)
class JimengAccountSlot:
    id: str
    alias: str
    home_dir: Path
    max_concurrent: int = 1


@dataclass
class JimengAccountLease:
    account: JimengAccountSlot
    semaphore: asyncio.Semaphore
    released: bool = False

    def release(self) -> None:
        if self.released:
            return
        self.released = True
        self.semaphore.release()
        wake_account_pool_waiters()


@dataclass(frozen=True)
class AccountPoolWaiter:
    id: str
    created_at: float


FAILURE_CATEGORY_META = {
    "upload": (
        "参考素材上传失败",
        "即梦上传参考素材时没有拿到完整上传结果，通常是平台上传通道或网络瞬时异常；系统会复查任务状态，必要时可稍后重试。",
    ),
    "audit": (
        "内容审核未通过",
        "提示词或参考图可能命中了即梦审核规则，请调整敏感动作、人物关系、暴力/低俗描述或参考图后重试。",
    ),
    "platform": (
        "即梦平台接口异常",
        "即梦平台返回接口失败，通常不是分镜本身的问题，可稍后重试。",
    ),
    "account": (
        "即梦账号或额度异常",
        "即梦账号状态、登录态、额度或并发限制可能异常，请检查后台即梦账号状态。",
    ),
    "input": (
        "素材或参数不被接受",
        "参考图、提示词或生成参数未被即梦接受，请检查图片格式、内容和分镜描述。",
    ),
    "timeout": (
        "即梦生成超时",
        "平台长时间没有返回结果，可能仍在排队或服务繁忙，可稍后重试。",
    ),
    "unknown": (
        "即梦生成失败",
        "即梦返回失败状态，但没有提供更明确的原因。",
    ),
}

FAILURE_REASON_CATEGORIES = {
    "api": "platform",
    "api_error": "platform",
    "server_error": "platform",
    "internal_error": "platform",
    "service_error": "platform",
    "system_error": "platform",
    "timeout": "timeout",
    "timed_out": "timeout",
    "upload": "upload",
    "upload_resource": "upload",
    "no_file_upload": "upload",
    "audit": "audit",
    "review": "audit",
    "risk": "audit",
    "sensitive": "audit",
    "content_risk": "audit",
    "content_security": "audit",
    "policy": "audit",
    "violation": "audit",
    "quota": "account",
    "credit": "account",
    "balance": "account",
    "insufficient_credit": "account",
    "rate_limited": "account",
    "concurrency": "account",
    "login": "account",
    "auth": "account",
    "image": "input",
    "invalid_image": "input",
    "invalid_param": "input",
    "parameter": "input",
    "prompt": "input",
}

DETAIL_KEYS = {
    "fail_message",
    "fail_msg",
    "failure_message",
    "status_msg",
    "status_message",
    "message",
    "msg",
    "error",
    "error_msg",
    "error_message",
    "detail",
    "reason",
    "description",
}

ACTIVE_GENERATION_STATUSES = {"querying", "queueing", "queued", "running", "processing", "pending", "submitted"}
SUCCESS_GENERATION_STATUSES = {"success", "done", "completed"}
FAILED_GENERATION_STATUSES = {"fail", "failed", "error"}
DREAMINA_CLI_POLL_INTERVAL_SECONDS = float(os.getenv("DREAMINA_CLI_POLL_INTERVAL_SECONDS", "20"))
DREAMINA_CLI_SLOT_CHECK_INTERVAL_SECONDS = float(os.getenv("DREAMINA_CLI_SLOT_CHECK_INTERVAL_SECONDS", "30"))
DEFAULT_ACCOUNT_ID = "default"
_account_pool_semaphores: Dict[str, asyncio.Semaphore] = {}
_account_pool_limits: Dict[str, int] = {}
_account_pool_next_index = 0
_account_pool_waiters: list[AccountPoolWaiter] = []
_account_pool_condition: Optional[asyncio.Condition] = None
_account_pool_condition_loop: Optional[asyncio.AbstractEventLoop] = None


def compact_failure_text(value: Any, max_length: int = 180) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        text = json.dumps(value, ensure_ascii=False)
    else:
        text = str(value)
    text = " ".join(text.replace("\x00", "").split())
    if len(text) > max_length:
        return f"{text[:max_length].rstrip()}..."
    return text


def find_first_by_key(value: Any, keys: set[str]) -> Optional[Any]:
    if isinstance(value, dict):
        for key, nested in value.items():
            if str(key).lower() in keys and nested not in (None, ""):
                return nested
        for nested in value.values():
            found = find_first_by_key(nested, keys)
            if found not in (None, ""):
                return found
    elif isinstance(value, list):
        for nested in value:
            found = find_first_by_key(nested, keys)
            if found not in (None, ""):
                return found
    return None


def infer_failure_category(reason: str, detail: str) -> str:
    normalized_reason = reason.strip().lower().replace("-", "_").replace(" ", "_")
    if normalized_reason in FAILURE_REASON_CATEGORIES:
        return FAILURE_REASON_CATEGORIES[normalized_reason]

    combined = f"{reason} {detail}".lower()
    if any(token in combined for token in ("upload resource", "upload image", "no file upload", "上传素材", "上传图片", "上传失败")):
        return "upload"
    if any(token in combined for token in ("审核", "违规", "敏感", "sensitive", "risk", "policy", "violation", "unsafe")):
        return "audit"
    if any(token in combined for token in ("timeout", "timed out", "超时", "排队", "busy", "繁忙")):
        return "timeout"
    if any(token in combined for token in ("api", "server", "internal", "service", "系统", "平台", "接口")):
        return "platform"
    if any(token in combined for token in ("quota", "credit", "balance", "rate", "login", "auth", "积分", "额度", "余额", "登录", "并发")):
        return "account"
    if any(token in combined for token in ("image", "file", "format", "prompt", "param", "图片", "素材", "格式", "参数", "提示词")):
        return "input"
    return "unknown"


def is_active_generation_status(status: Optional[str]) -> bool:
    return (status or "").strip().lower() in ACTIVE_GENERATION_STATUSES


def is_success_generation_status(status: Optional[str]) -> bool:
    return (status or "").strip().lower() in SUCCESS_GENERATION_STATUSES


def is_failed_generation_status(status: Optional[str]) -> bool:
    return (status or "").strip().lower() in FAILED_GENERATION_STATUSES


def coerce_int(value: Any) -> Optional[int]:
    if value in (None, ""):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def extract_queue_info(value: Any) -> Optional[Dict[str, Any]]:
    raw_queue_info = find_first_by_key(value, {"queue_info", "queueinfo"})
    if not isinstance(raw_queue_info, dict):
        return None

    queue_position = coerce_int(
        raw_queue_info.get("queue_idx")
        or raw_queue_info.get("queueIndex")
        or raw_queue_info.get("queue_position")
        or raw_queue_info.get("queuePosition")
    )
    queue_total = coerce_int(
        raw_queue_info.get("queue_length")
        or raw_queue_info.get("queueLength")
        or raw_queue_info.get("queue_total")
        or raw_queue_info.get("queueTotal")
    )
    queue_status = raw_queue_info.get("queue_status") or raw_queue_info.get("queueStatus")

    if queue_position is None and queue_total is None and queue_status in (None, ""):
        return None

    return {
        "position": queue_position,
        "total": queue_total,
        "status": str(queue_status) if queue_status not in (None, "") else None,
    }


def emit_progress(progress_callback: Optional[Callable[[Dict[str, Any]], None]], payload: Dict[str, Any]) -> None:
    if not progress_callback:
        return
    try:
        progress_callback(payload)
    except Exception:
        return


def check_cancellation(cancellation_check: Optional[Callable[[], None]]) -> None:
    if cancellation_check:
        cancellation_check()


def account_pool_signature(account: JimengAccountSlot) -> str:
    return f"{account.id}:{account.home_dir}:{account.max_concurrent}"


def normalize_account_id(value: str, fallback: str) -> str:
    normalized = "".join(
        character if character.isalnum() or character in {"-", "_"} else "-"
        for character in (value or "").strip().lower()
    ).strip("-")
    return normalized or fallback


def coerce_positive_int(value: Any, fallback: int = 1) -> int:
    if value in (None, ""):
        return fallback
    try:
        return max(int(value), 1)
    except (TypeError, ValueError) as exc:
        raise JimengCliError(f"即梦账号并发数必须是正整数：{value}") from exc


def parse_account_pool_config() -> list[JimengAccountSlot]:
    raw_accounts = os.getenv("DREAMINA_CLI_ACCOUNTS", "").strip()
    accounts: list[JimengAccountSlot] = []

    if raw_accounts:
        try:
            payload = json.loads(raw_accounts)
        except json.JSONDecodeError as exc:
            raise JimengCliError(f"DREAMINA_CLI_ACCOUNTS 不是合法 JSON：{exc}") from exc
        if not isinstance(payload, list):
            raise JimengCliError("DREAMINA_CLI_ACCOUNTS 必须是账号对象数组")

        for index, item in enumerate(payload, start=1):
            if not isinstance(item, dict):
                continue
            account_id = normalize_account_id(str(item.get("id") or item.get("name") or ""), f"account-{index}")
            alias = str(item.get("alias") or item.get("label") or account_id)
            home = str(item.get("home") or item.get("homeDir") or item.get("home_dir") or "").strip()
            if not home:
                raise JimengCliError(f"即梦账号 {account_id} 缺少 home/homeDir")
            max_concurrent = coerce_positive_int(item.get("maxConcurrent") or item.get("max_concurrent"), 1)
            accounts.append(JimengAccountSlot(
                id=account_id,
                alias=alias,
                home_dir=Path(home).expanduser(),
                max_concurrent=max_concurrent,
            ))

    raw_homes = os.getenv("DREAMINA_CLI_HOMES", "").strip()
    if not accounts and raw_homes:
        for index, home in enumerate([part.strip() for part in raw_homes.split(",") if part.strip()], start=1):
            account_id = f"account-{index}"
            accounts.append(JimengAccountSlot(
                id=account_id,
                alias=account_id,
                home_dir=Path(home).expanduser(),
                max_concurrent=coerce_positive_int(os.getenv("DREAMINA_CLI_ACCOUNT_MAX_CONCURRENT"), 1),
            ))

    if not accounts:
        accounts.append(JimengAccountSlot(
            id=DEFAULT_ACCOUNT_ID,
            alias=os.getenv("DREAMINA_CLI_DEFAULT_ALIAS", "默认即梦账号"),
            home_dir=Path.home(),
            max_concurrent=coerce_positive_int(os.getenv("DREAMINA_CLI_ACCOUNT_MAX_CONCURRENT"), 1),
        ))

    deduped: list[JimengAccountSlot] = []
    seen_ids: set[str] = set()
    for account in accounts:
        account_id = account.id
        if account_id in seen_ids:
            account_id = f"{account_id}-{len(seen_ids) + 1}"
            account = JimengAccountSlot(
                id=account_id,
                alias=account.alias,
                home_dir=account.home_dir,
                max_concurrent=account.max_concurrent,
            )
        seen_ids.add(account_id)
        deduped.append(account)
    return deduped


def get_account_pool() -> list[JimengAccountSlot]:
    accounts = parse_account_pool_config()
    active_signatures = {account_pool_signature(account) for account in accounts}
    for account in accounts:
        signature = account_pool_signature(account)
        if signature not in _account_pool_semaphores or _account_pool_limits.get(signature) != account.max_concurrent:
            _account_pool_semaphores[signature] = asyncio.Semaphore(account.max_concurrent)
            _account_pool_limits[signature] = account.max_concurrent

    for signature in list(_account_pool_semaphores):
        if signature not in active_signatures:
            _account_pool_semaphores.pop(signature, None)
            _account_pool_limits.pop(signature, None)

    return accounts


def get_account_runtime_snapshot() -> list[Dict[str, Any]]:
    snapshots = []
    for account in get_account_pool():
        signature = account_pool_signature(account)
        semaphore = _account_pool_semaphores.get(signature)
        available = getattr(semaphore, "_value", account.max_concurrent) if semaphore else account.max_concurrent
        snapshots.append({
            "id": account.id,
            "alias": account.alias,
            "homeDir": str(account.home_dir),
            "maxConcurrent": account.max_concurrent,
            "activeLeases": max(account.max_concurrent - int(available), 0),
            "availableLeases": max(int(available), 0),
            "tokenExists": (account.home_dir / ".local" / "share" / "dreamina" / "byted_cli_user_token.json").is_file(),
        })
    return snapshots


def get_account_pool_capacity_snapshot() -> Dict[str, int]:
    capacity = 0
    active = 0
    for account in get_account_pool():
        signature = account_pool_signature(account)
        semaphore = _account_pool_semaphores.get(signature)
        available = getattr(semaphore, "_value", account.max_concurrent) if semaphore else account.max_concurrent
        capacity += account.max_concurrent
        active += max(account.max_concurrent - int(available), 0)
    return {
        "active": active,
        "capacity": capacity,
    }


def get_account_pool_condition() -> asyncio.Condition:
    global _account_pool_condition, _account_pool_condition_loop

    loop = asyncio.get_running_loop()
    if _account_pool_condition is None or _account_pool_condition_loop is not loop:
        _account_pool_condition = asyncio.Condition()
        _account_pool_condition_loop = loop
        _account_pool_waiters.clear()
    return _account_pool_condition


def wake_account_pool_waiters() -> None:
    try:
        condition = get_account_pool_condition()
    except RuntimeError:
        return

    async def notify_waiters() -> None:
        async with condition:
            condition.notify_all()

    try:
        asyncio.create_task(notify_waiters())
    except RuntimeError:
        return


def get_account_pool_waiter_position(waiter: AccountPoolWaiter) -> int:
    for index, queued_waiter in enumerate(_account_pool_waiters, start=1):
        if queued_waiter.id == waiter.id:
            return index
    return 1


def build_account_pool_queue_info(waiter: AccountPoolWaiter) -> Dict[str, Any]:
    position = get_account_pool_waiter_position(waiter)
    capacity_snapshot = get_account_pool_capacity_snapshot()
    return {
        "position": position,
        "total": max(len(_account_pool_waiters), position),
        "status": "account_pool_waiting",
        "ahead": max(position - 1, 0),
        "active": capacity_snapshot["active"],
        "capacity": capacity_snapshot["capacity"],
    }


def emit_account_pool_queue_progress(
    progress_callback: Optional[Callable[[Dict[str, Any]], None]],
    waiter: AccountPoolWaiter,
) -> None:
    emit_progress(progress_callback, {
        "submitId": None,
        "status": "account_pool_waiting",
        "queueInfo": build_account_pool_queue_info(waiter),
        "accountId": None,
        "accountAlias": None,
    })


def cli_environment(cli_home: Optional[Path] = None) -> Dict[str, str]:
    env = {**os.environ, "NO_COLOR": "1"}
    if cli_home:
        cli_home.mkdir(parents=True, exist_ok=True)
        env["HOME"] = str(cli_home)
        env["PATH"] = f"{cli_home / '.local' / 'bin'}:{env.get('PATH', '')}"
    return env


def describe_generation_failure(result: Any) -> JimengFailureDetails:
    reason = compact_failure_text(find_first_by_key(
        result,
        {"fail_reason", "failreason", "failure_reason", "reason_code", "error_code", "code"},
    ), max_length=80)
    detail = compact_failure_text(find_first_by_key(result, DETAIL_KEYS))
    submit_id = compact_failure_text(find_submit_id(result), max_length=120)
    log_id = compact_failure_text(find_first_by_key(result, {"logid", "log_id", "request_id", "trace_id"}), max_length=120)

    category = infer_failure_category(reason, detail)
    title, default_detail = FAILURE_CATEGORY_META[category]

    if reason.strip().lower() == "api":
        detail = "即梦返回 API 失败，通常是平台接口或服务侧异常；如果同一分镜连续失败，再检查提示词和参考图。"
    elif not detail or detail.strip().lower() == reason.strip().lower():
        detail = default_detail

    return JimengFailureDetails(
        category=category,
        title=title,
        detail=detail,
        reason=reason or None,
        submit_id=submit_id or None,
        log_id=log_id or None,
    )


def format_generation_failure(details: JimengFailureDetails) -> str:
    metadata = []
    if details.reason:
        metadata.append(f"原因码：{details.reason}")
    if details.submit_id:
        metadata.append(f"提交ID：{details.submit_id}")
    if details.log_id:
        metadata.append(f"日志ID：{details.log_id}")

    message = f"{details.title}：{details.detail}"
    if metadata:
        message = f"{message}（{'，'.join(metadata)}）"
    return message


def resolve_dreamina_command() -> Optional[list[str]]:
    configured_command = os.getenv("DREAMINA_CLI")
    if configured_command:
        configured_path = Path(configured_command).expanduser()
        if configured_path.is_file():
            return [str(configured_path.resolve())]
        return [configured_command]

    wrapper = shutil.which("dreamina")
    if wrapper:
        return [wrapper]

    fallback_path = Path.home() / ".local" / "bin" / "dreamina"
    if fallback_path.is_file():
        return [str(fallback_path)]

    return None


def resolve_legacy_cli_command() -> Optional[list[str]]:
    node_path = shutil.which("node")
    if not node_path:
        return None

    configured_entry = os.getenv("JIMENG_CLI_ENTRY")
    project_root = Path(__file__).resolve().parent.parent
    candidates = [
        Path(configured_entry) if configured_entry else None,
        project_root / "node_modules" / "jimeng-cli" / "dist" / "cli" / "index.js",
    ]

    wrapper = shutil.which("jimeng.cmd") or shutil.which("jimeng")
    if wrapper:
        wrapper_path = Path(wrapper).resolve()
        candidates.append(wrapper_path.parent / "node_modules" / "jimeng-cli" / "dist" / "cli" / "index.js")

    for candidate in candidates:
        if candidate and candidate.is_file():
            return [node_path, str(candidate)]
    return None


def cli_public_status() -> dict[str, Any]:
    command = resolve_dreamina_command() or resolve_legacy_cli_command()
    token_pool = Path(os.getenv("TOKEN_POOL_FILE", Path.home() / ".jimeng" / "token-pool.json"))
    token_count = 0
    if token_pool.is_file():
        try:
            data = json.loads(token_pool.read_text(encoding="utf-8-sig"))
            tokens = data.get("tokens", []) if isinstance(data, dict) else data
            token_count = len(tokens) if isinstance(tokens, list) else 0
        except (OSError, json.JSONDecodeError):
            token_count = 0

    try:
        account_pool = get_account_runtime_snapshot()
        account_pool_error = None
    except JimengCliError as exc:
        account_pool = []
        account_pool_error = str(exc)

    return {
        "available": bool(command),
        "command": " ".join(command) if command else None,
        "officialCliAvailable": bool(resolve_dreamina_command()),
        "legacyCliAvailable": bool(resolve_legacy_cli_command()),
        "tokenPoolConfigured": token_count > 0,
        "tokenCount": token_count,
        "accountPool": account_pool,
        "accountPoolError": account_pool_error,
    }


def parse_json_value(output: str) -> Any:
    decoder = json.JSONDecoder()
    parsed_objects = []
    for index, character in enumerate(output):
        if character not in "{[":
            continue
        try:
            value, end = decoder.raw_decode(output[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, (dict, list)):
            parsed_objects.append((index + end, end, value))

    if not parsed_objects:
        raise JimengCliError("即梦 CLI 未返回可解析的 JSON 结果")
    return max(parsed_objects, key=lambda item: (item[0], item[1]))[2]


def parse_json_output(output: str) -> dict[str, Any]:
    value = parse_json_value(output)
    if not isinstance(value, dict):
        raise JimengCliError("即梦 CLI 未返回 JSON object")
    return value


def collect_files_recursive(value: Any) -> list[str]:
    files = []
    if isinstance(value, dict):
        for key, nested in value.items():
            if key in {"file", "path", "download_path", "downloaded_path"} and isinstance(nested, str):
                files.append(nested)
            elif key in {"files", "downloaded_files"} and isinstance(nested, list):
                files.extend(str(item) for item in nested if isinstance(item, str))
            else:
                files.extend(collect_files_recursive(nested))
    elif isinstance(value, list):
        for nested in value:
            files.extend(collect_files_recursive(nested))
    return files


def find_first_url(value: Any) -> Optional[str]:
    if isinstance(value, dict):
        for key in ("url", "video_url", "videoUrl"):
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate.startswith(("http://", "https://")):
                return candidate
        for nested in value.values():
            found = find_first_url(nested)
            if found:
                return found
    elif isinstance(value, list):
        for nested in value:
            found = find_first_url(nested)
            if found:
                return found
    return None


def collect_files(value: Any) -> list[str]:
    recursive_files = collect_files_recursive(value)
    if recursive_files:
        return recursive_files
    if not isinstance(value, dict):
        return []
    data = value.get("data")
    if isinstance(data, dict) and isinstance(data.get("files"), list):
        return [str(item) for item in data["files"] if isinstance(item, str)]
    if isinstance(value.get("files"), list):
        return [str(item) for item in value["files"] if isinstance(item, str)]
    return []


def find_submit_id(value: Any) -> Optional[str]:
    if isinstance(value, dict):
        for key in ("submit_id", "submitId", "task_id", "taskId"):
            candidate = value.get(key)
            if candidate:
                return str(candidate)
        for nested in value.values():
            found = find_submit_id(nested)
            if found:
                return found
    elif isinstance(value, list):
        for nested in value:
            found = find_submit_id(nested)
            if found:
                return found
    return None


def find_generation_status(value: Any) -> Optional[str]:
    if isinstance(value, dict):
        for key in ("gen_status", "status", "task_status"):
            candidate = value.get(key)
            if isinstance(candidate, str):
                return candidate.lower()
        for nested in value.values():
            found = find_generation_status(nested)
            if found:
                return found
    elif isinstance(value, list):
        for nested in value:
            found = find_generation_status(nested)
            if found:
                return found
    return None


def file_to_public_url(file_path: Path, public_root: Path, public_url_prefix: str) -> Optional[str]:
    try:
        resolved_file = file_path.resolve()
        resolved_root = public_root.resolve()
        relative_path = resolved_file.relative_to(resolved_root)
    except ValueError:
        return None

    encoded_parts = [quote(part) for part in relative_path.parts]
    return f"{public_url_prefix.rstrip('/')}/{'/'.join(encoded_parts)}"


def normalize_model_version(model: str) -> str:
    normalized = (model or "").strip()
    aliases = {
        "jimeng-video-seedance-2.0": "seedance2.0",
        "jimeng-video-seedance-2.0-fast": "seedance2.0fast",
        "jimeng-video-seedance-2.0-vip": "seedance2.0_vip",
        "jimeng-video-seedance-2.0-fast-vip": "seedance2.0fast_vip",
    }
    return aliases.get(normalized, normalized or "seedance2.0fast")


async def run_cli_json(
    command: list[str],
    timeout_seconds: int = 120,
    cli_home: Optional[Path] = None,
    cancellation_check: Optional[Callable[[], None]] = None,
) -> Any:
    check_cancellation(cancellation_check)
    creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    process = await asyncio.create_subprocess_exec(
        *command,
        cwd=str(Path(__file__).resolve().parent.parent),
        env=cli_environment(cli_home),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        creationflags=creation_flags,
    )

    communicate_task = asyncio.create_task(process.communicate())
    deadline = time.monotonic() + max(timeout_seconds, 1)
    try:
        while True:
            check_cancellation(cancellation_check)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise asyncio.TimeoutError()
            done, _ = await asyncio.wait({communicate_task}, timeout=min(1.0, remaining))
            if done:
                stdout, stderr = communicate_task.result()
                break
    except asyncio.TimeoutError as exc:
        if process.returncode is None:
            process.kill()
        await communicate_task
        raise JimengCliError("即梦 CLI 命令超时") from exc
    except Exception:
        if process.returncode is None:
            process.kill()
        await communicate_task
        raise

    stdout_text = stdout.decode("utf-8", errors="replace")
    stderr_text = stderr.decode("utf-8", errors="replace")
    if process.returncode != 0:
        message = (stderr_text or stdout_text).strip().splitlines()
        detail = message[-1] if message else "未知错误"
        raise JimengCliError(f"即梦 CLI 命令失败：{detail[:400]}")

    return parse_json_value(stdout_text)


async def get_single_account_snapshot(command: list[str], account: JimengAccountSlot, task_limit: int) -> dict[str, Any]:
    snapshot: dict[str, Any] = {
        "id": account.id,
        "alias": account.alias,
        "homeDir": str(account.home_dir),
        "maxConcurrent": account.max_concurrent,
        "account": None,
        "version": None,
        "tasks": [],
        "summary": {
            "totalTasks": 0,
            "successTasks": 0,
            "failedTasks": 0,
            "activeTasks": 0,
            "recentCreditUsed": 0,
        },
        "error": None,
    }

    try:
        version = await run_cli_json([*command, "version"], timeout_seconds=30, cli_home=account.home_dir)
        account_info = await run_cli_json([*command, "user_credit"], timeout_seconds=60, cli_home=account.home_dir)
        tasks = await run_cli_json([*command, "list_task", f"--limit={task_limit}"], timeout_seconds=90, cli_home=account.home_dir)
        if not isinstance(tasks, list):
            tasks = []

        normalized_tasks = [task for task in tasks if isinstance(task, dict)]
        snapshot["version"] = version
        snapshot["account"] = account_info
        snapshot["tasks"] = normalized_tasks
        snapshot["summary"] = {
            "totalTasks": len(normalized_tasks),
            "successTasks": len([task for task in normalized_tasks if task.get("gen_status") == "success"]),
            "failedTasks": len([task for task in normalized_tasks if task.get("gen_status") == "fail"]),
            "activeTasks": len([
                task for task in normalized_tasks
                if is_active_generation_status(str(task.get("gen_status") or task.get("status") or ""))
            ]),
            "recentCreditUsed": sum(
                int(((task.get("commerce_info") or {}).get("credit_count") or 0))
                for task in normalized_tasks
            ),
        }
    except JimengCliError as exc:
        snapshot["error"] = str(exc)

    return snapshot


async def get_account_snapshot(task_limit: int = 10) -> dict[str, Any]:
    command = resolve_dreamina_command()
    status = cli_public_status()
    snapshot: dict[str, Any] = {
        "cli": status,
        "account": None,
        "version": None,
        "tasks": [],
        "accounts": [],
        "summary": {
            "totalTasks": 0,
            "successTasks": 0,
            "failedTasks": 0,
            "activeTasks": 0,
            "recentCreditUsed": 0,
        },
        "error": None,
    }

    if not command:
        snapshot["error"] = "未找到官方 dreamina CLI"
        return snapshot

    try:
        accounts = get_account_pool()
    except JimengCliError as exc:
        snapshot["error"] = str(exc)
        return snapshot
    account_snapshots = await asyncio.gather(*[
        get_single_account_snapshot(command, account, task_limit)
        for account in accounts
    ])
    snapshot["accounts"] = account_snapshots

    if account_snapshots:
        first = account_snapshots[0]
        snapshot["account"] = first["account"]
        snapshot["version"] = first["version"]
        snapshot["tasks"] = first["tasks"]
        snapshot["error"] = first["error"]

    snapshot["summary"] = {
        "totalTasks": sum(item["summary"]["totalTasks"] for item in account_snapshots),
        "successTasks": sum(item["summary"]["successTasks"] for item in account_snapshots),
        "failedTasks": sum(item["summary"]["failedTasks"] for item in account_snapshots),
        "activeTasks": sum(item["summary"].get("activeTasks", 0) for item in account_snapshots),
        "recentCreditUsed": sum(item["summary"]["recentCreditUsed"] for item in account_snapshots),
    }

    return snapshot


def result_to_video_url(result: Any, output_dir: Path, public_root: Optional[Path], public_url_prefix: str) -> Optional[str]:
    video_url = find_first_url(result)
    if video_url:
        return video_url
    if not public_root:
        return None

    for file_name in collect_files(result):
        file_path = Path(file_name)
        if not file_path.is_absolute():
            file_path = output_dir / file_path
        if file_path.is_file():
            public_url = file_to_public_url(file_path, public_root, public_url_prefix)
            if public_url:
                return public_url
    return None


async def query_dreamina_result(
    command: list[str],
    submit_id: str,
    output_dir: Path,
    cli_home: Optional[Path] = None,
    cancellation_check: Optional[Callable[[], None]] = None,
) -> Any:
    return await run_cli_json(
        [*command, "query_result", f"--submit_id={submit_id}", "--download_dir", str(output_dir.resolve())],
        timeout_seconds=180,
        cli_home=cli_home,
        cancellation_check=cancellation_check,
    )


async def refresh_active_task_status(
    command: list[str],
    submit_id: str,
    output_dir: Path,
    cli_home: Optional[Path] = None,
    cancellation_check: Optional[Callable[[], None]] = None,
) -> Optional[str]:
    try:
        result = await query_dreamina_result(
            command,
            submit_id,
            output_dir,
            cli_home=cli_home,
            cancellation_check=cancellation_check,
        )
    except JimengCliError:
        return None
    return find_generation_status(result)


async def get_active_generation_tasks(
    command: list[str],
    account: JimengAccountSlot,
    output_dir: Path,
    cancellation_check: Optional[Callable[[], None]] = None,
) -> list[dict[str, Any]]:
    check_cancellation(cancellation_check)
    check_dir = output_dir / "_slot_checks" / account.id
    check_dir.mkdir(parents=True, exist_ok=True)
    tasks = await run_cli_json(
        [*command, "list_task", "--limit=20"],
        timeout_seconds=90,
        cli_home=account.home_dir,
        cancellation_check=cancellation_check,
    )
    active_tasks = [
        task for task in tasks
        if isinstance(task, dict) and is_active_generation_status(str(task.get("gen_status") or task.get("status") or ""))
    ] if isinstance(tasks, list) else []

    for task in active_tasks[:3]:
        submit_id = task.get("submit_id") or task.get("submitId") or task.get("task_id") or task.get("taskId")
        if submit_id:
            await refresh_active_task_status(
                command,
                str(submit_id),
                check_dir,
                cli_home=account.home_dir,
                cancellation_check=cancellation_check,
            )

    tasks = await run_cli_json(
        [*command, "list_task", "--limit=20"],
        timeout_seconds=90,
        cli_home=account.home_dir,
        cancellation_check=cancellation_check,
    )
    return [
        task for task in tasks
        if isinstance(task, dict) and is_active_generation_status(str(task.get("gen_status") or task.get("status") or ""))
    ] if isinstance(tasks, list) else []


async def try_acquire_account_lease_once(
    command: list[str],
    output_dir: Path,
    cancellation_check: Optional[Callable[[], None]] = None,
) -> tuple[Optional[JimengAccountLease], list[str], list[str]]:
    global _account_pool_next_index

    check_cancellation(cancellation_check)
    last_active_ids: list[str] = []
    last_errors: list[str] = []

    accounts = get_account_pool()
    if not accounts:
        raise JimengCliError("即梦账号池为空")

    start_index = _account_pool_next_index % len(accounts)
    ordered_accounts = accounts[start_index:] + accounts[:start_index]

    for account in ordered_accounts:
        check_cancellation(cancellation_check)
        signature = account_pool_signature(account)
        semaphore = _account_pool_semaphores[signature]
        if getattr(semaphore, "_value", 0) <= 0:
            continue

        await semaphore.acquire()
        lease = JimengAccountLease(account=account, semaphore=semaphore)
        _account_pool_next_index = (accounts.index(account) + 1) % len(accounts)

        try:
            active_tasks = await get_active_generation_tasks(
                command,
                account,
                output_dir,
                cancellation_check=cancellation_check,
            )
        except JimengCliError as exc:
            lease.release()
            last_errors.append(f"{account.alias}: {exc}")
            continue

        if not active_tasks:
            return lease, last_active_ids, last_errors

        lease.release()
        last_active_ids = [
            str(task.get("submit_id") or task.get("submitId") or task.get("task_id") or task.get("taskId") or "unknown")
            for task in active_tasks[:3]
        ]

    return None, last_active_ids, last_errors


def raise_account_pool_busy(last_active_ids: list[str], last_errors: list[str]) -> None:
    if last_errors and not last_active_ids:
        detail = "；".join(last_errors[-3:])
    else:
        detail = f"所有即梦账号都有任务占用生成通道：{', '.join(last_active_ids) if last_active_ids else 'unknown'}"
    raise JimengCliError(
        detail,
        failure_category="account",
        failure_title="即梦账号池暂无空闲账号",
        failure_reason="account_pool_busy",
        failure_detail="多个用户任务已进入账号池排队，系统会在账号空闲后继续提交。",
    )


async def wait_for_account_pool_signal(
    condition: asyncio.Condition,
    deadline: float,
    cancellation_check: Optional[Callable[[], None]] = None,
) -> None:
    check_cancellation(cancellation_check)
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        return
    wait_seconds = min(max(DREAMINA_CLI_SLOT_CHECK_INTERVAL_SECONDS, 5), remaining)
    try:
        await asyncio.wait_for(condition.wait(), timeout=wait_seconds)
    except asyncio.TimeoutError:
        return
    finally:
        check_cancellation(cancellation_check)


async def acquire_account_lease(
    command: list[str],
    timeout_seconds: int,
    output_dir: Path,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    cancellation_check: Optional[Callable[[], None]] = None,
) -> JimengAccountLease:
    check_cancellation(cancellation_check)
    deadline = time.monotonic() + max(timeout_seconds, 1)
    last_active_ids: list[str] = []
    last_errors: list[str] = []
    waiter = AccountPoolWaiter(id=str(uuid.uuid4()), created_at=time.monotonic())
    condition = get_account_pool_condition()

    async with condition:
        _account_pool_waiters.append(waiter)
        condition.notify_all()

    try:
        while True:
            check_cancellation(cancellation_check)
            async with condition:
                if waiter not in _account_pool_waiters:
                    _account_pool_waiters.append(waiter)
                emit_account_pool_queue_progress(progress_callback, waiter)
                is_first = bool(_account_pool_waiters and _account_pool_waiters[0].id == waiter.id)
                if not is_first:
                    if time.monotonic() >= deadline:
                        raise_account_pool_busy(last_active_ids, last_errors)
                    await wait_for_account_pool_signal(condition, deadline, cancellation_check=cancellation_check)
                    continue

            if time.monotonic() >= deadline:
                raise_account_pool_busy(last_active_ids, last_errors)

            lease, active_ids, errors = await try_acquire_account_lease_once(
                command,
                output_dir,
                cancellation_check=cancellation_check,
            )
            last_active_ids = active_ids or last_active_ids
            last_errors = errors or last_errors
            if lease:
                async with condition:
                    _account_pool_waiters[:] = [
                        queued_waiter for queued_waiter in _account_pool_waiters
                        if queued_waiter.id != waiter.id
                    ]
                    condition.notify_all()
                return lease

            async with condition:
                emit_account_pool_queue_progress(progress_callback, waiter)
                if time.monotonic() >= deadline:
                    raise_account_pool_busy(last_active_ids, last_errors)
                await wait_for_account_pool_signal(condition, deadline, cancellation_check=cancellation_check)
    finally:
        async with condition:
            original_count = len(_account_pool_waiters)
            _account_pool_waiters[:] = [
                queued_waiter for queued_waiter in _account_pool_waiters
                if queued_waiter.id != waiter.id
            ]
            if len(_account_pool_waiters) != original_count:
                condition.notify_all()


async def poll_dreamina_result(
    *,
    command: list[str],
    account: JimengAccountSlot,
    submit_id: str,
    output_dir: Path,
    public_root: Optional[Path],
    public_url_prefix: str,
    timeout_seconds: int,
    initial_result: Any = None,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    cancellation_check: Optional[Callable[[], None]] = None,
) -> JimengCliResult:
    deadline = time.monotonic() + max(timeout_seconds, 1)
    latest_result = initial_result
    latest_files: list[str] = []

    while True:
        check_cancellation(cancellation_check)
        if latest_result is None:
            latest_result = await query_dreamina_result(
                command,
                submit_id,
                output_dir,
                cli_home=account.home_dir,
                cancellation_check=cancellation_check,
            )

        status = find_generation_status(latest_result)
        queue_info = extract_queue_info(latest_result)
        emit_progress(progress_callback, {
            "submitId": submit_id,
            "status": status,
            "queueInfo": queue_info,
            "accountId": account.id,
            "accountAlias": account.alias,
        })
        files = collect_files(latest_result)
        latest_files = files or latest_files
        video_url = result_to_video_url(latest_result, output_dir, public_root, public_url_prefix)
        if video_url:
            return JimengCliResult(
                video_url=video_url,
                files=latest_files,
                account_id=account.id,
                account_alias=account.alias,
            )

        if is_failed_generation_status(status):
            failure = describe_generation_failure(latest_result)
            if failure.submit_id is None:
                failure.submit_id = submit_id
            raise JimengCliError(
                format_generation_failure(failure),
                failure_category=failure.category,
                failure_title=failure.title,
                failure_reason=failure.reason,
                failure_detail=failure.detail,
                failure_submit_id=failure.submit_id,
                failure_log_id=failure.log_id,
            )

        if status and not is_active_generation_status(status) and not is_success_generation_status(status):
            raise JimengCliError(
                f"即梦返回未知任务状态：{status}",
                failure_category="unknown",
                failure_title="即梦任务状态异常",
                failure_reason=status,
                failure_detail="即梦返回了暂未识别的任务状态，请稍后重试或查看即梦任务列表。",
                failure_submit_id=submit_id,
            )

        if is_success_generation_status(status):
            raise JimengCliError(
                "即梦任务已成功，但结果中没有视频地址或本地下载文件",
                failure_category="unknown",
                failure_title="即梦结果缺少视频",
                failure_reason=status,
                failure_detail="即梦任务状态为成功，但 CLI 没有返回可用的视频文件。",
                failure_submit_id=submit_id,
            )

        if time.monotonic() >= deadline:
            raise JimengCliError(
                "即梦任务仍在排队或生成中，已超过等待时间",
                failure_category="timeout",
                failure_title="即梦生成等待超时",
                failure_reason=status or "query_timeout",
                failure_detail="即梦平台长时间未返回最终结果，任务可能仍在队列中。请稍后在即梦任务列表或创作台重试查询。",
                failure_submit_id=submit_id,
            )

        poll_sleep_seconds = max(DREAMINA_CLI_POLL_INTERVAL_SECONDS, 5)
        sleep_deadline = time.monotonic() + poll_sleep_seconds
        while time.monotonic() < sleep_deadline:
            check_cancellation(cancellation_check)
            await asyncio.sleep(min(1.0, max(sleep_deadline - time.monotonic(), 0)))
        latest_result = await query_dreamina_result(
            command,
            submit_id,
            output_dir,
            cli_home=account.home_dir,
            cancellation_check=cancellation_check,
        )


async def generate_video_with_dreamina(
    *,
    prompt: str,
    duration: int,
    ratio: str,
    model: str,
    output_dir: Path,
    reference_paths: Iterable[Path],
    public_root: Optional[Path],
    public_url_prefix: str,
    timeout_seconds: int,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    cancellation_check: Optional[Callable[[], None]] = None,
) -> JimengCliResult:
    check_cancellation(cancellation_check)
    command = resolve_dreamina_command()
    if not command:
        raise JimengCliError("未找到官方 dreamina CLI")

    references = [path.resolve() for path in reference_paths]
    output_dir.mkdir(parents=True, exist_ok=True)
    clipped_duration = str(max(4, min(duration, 15)))
    model_version = normalize_model_version(model)

    if references:
        arguments = [
            *command,
            "multimodal2video",
            "--prompt",
            prompt,
            "--duration",
            clipped_duration,
            "--ratio",
            ratio,
            "--video_resolution",
            "720p",
            "--model_version",
            model_version,
            "--poll",
            "0",
        ]
        for reference in references:
            arguments.extend(["--image", str(reference)])
    else:
        arguments = [
            *command,
            "text2video",
            "--prompt",
            prompt,
            "--duration",
            clipped_duration,
            "--ratio",
            ratio,
            "--video_resolution",
            "720p",
            "--model_version",
            model_version,
            "--poll",
            "0",
        ]

    lease = await acquire_account_lease(
        command,
        timeout_seconds,
        output_dir,
        progress_callback=progress_callback,
        cancellation_check=cancellation_check,
    )
    account = lease.account

    try:
        check_cancellation(cancellation_check)
        emit_progress(progress_callback, {
            "submitId": None,
            "status": "account_acquired",
            "queueInfo": None,
            "accountId": account.id,
            "accountAlias": account.alias,
        })
        result = await run_cli_json(
            arguments,
            timeout_seconds=300,
            cli_home=account.home_dir,
            cancellation_check=cancellation_check,
        )
        submit_id = find_submit_id(result)
        status = find_generation_status(result)
        emit_progress(progress_callback, {
            "submitId": submit_id,
            "status": status,
            "queueInfo": extract_queue_info(result),
            "accountId": account.id,
            "accountAlias": account.alias,
        })
        video_url = result_to_video_url(result, output_dir, public_root, public_url_prefix)
        files = collect_files(result)

        if submit_id and not video_url:
            try:
                query_result = await query_dreamina_result(
                    command,
                    submit_id,
                    output_dir,
                    cli_home=account.home_dir,
                    cancellation_check=cancellation_check,
                )
                query_status = find_generation_status(query_result)
                if is_active_generation_status(query_status) or is_success_generation_status(query_status):
                    return await poll_dreamina_result(
                        command=command,
                        account=account,
                        submit_id=submit_id,
                        output_dir=output_dir,
                        public_root=public_root,
                        public_url_prefix=public_url_prefix,
                        timeout_seconds=timeout_seconds,
                        initial_result=query_result,
                        progress_callback=progress_callback,
                        cancellation_check=cancellation_check,
                    )
                result = query_result
                status = query_status
                video_url = result_to_video_url(result, output_dir, public_root, public_url_prefix)
                files = collect_files(result) or files
            except JimengCliError:
                if not is_failed_generation_status(status):
                    raise

        if submit_id and (is_active_generation_status(status) or is_success_generation_status(status)):
            return await poll_dreamina_result(
                command=command,
                account=account,
                submit_id=submit_id,
                output_dir=output_dir,
                public_root=public_root,
                public_url_prefix=public_url_prefix,
                timeout_seconds=timeout_seconds,
                initial_result=result,
                progress_callback=progress_callback,
                cancellation_check=cancellation_check,
            )

        if is_failed_generation_status(status):
            failure = describe_generation_failure(result)
            raise JimengCliError(
                format_generation_failure(failure),
                failure_category=failure.category,
                failure_title=failure.title,
                failure_reason=failure.reason,
                failure_detail=failure.detail,
                failure_submit_id=failure.submit_id,
                failure_log_id=failure.log_id,
            )
        if not video_url:
            raise JimengCliError("即梦 CLI 已结束，但结果中没有视频地址或本地下载文件")

        return JimengCliResult(
            video_url=video_url,
            files=files,
            account_id=account.id,
            account_alias=account.alias,
        )
    finally:
        lease.release()


async def generate_video(
    *,
    prompt: str,
    duration: int,
    ratio: str,
    model: str,
    region: str,
    output_dir: Path,
    reference_paths: Iterable[Path] = (),
    public_root: Optional[Path] = None,
    public_url_prefix: str = "/api/outputs",
    timeout_seconds: int = 7200,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    cancellation_check: Optional[Callable[[], None]] = None,
) -> JimengCliResult:
    check_cancellation(cancellation_check)
    if resolve_dreamina_command():
        return await generate_video_with_dreamina(
            prompt=prompt,
            duration=duration,
            ratio=ratio,
            model=model,
            output_dir=output_dir,
            reference_paths=reference_paths,
            public_root=public_root,
            public_url_prefix=public_url_prefix,
            timeout_seconds=timeout_seconds,
            progress_callback=progress_callback,
            cancellation_check=cancellation_check,
        )

    command = resolve_legacy_cli_command()
    if not command:
        raise JimengCliError("未找到内置即梦 CLI，请先安装项目依赖")

    references = [path.resolve() for path in reference_paths]
    missing_references = [str(path) for path in references if not path.is_file()]
    if missing_references:
        raise JimengCliError("参考图片文件不存在，无法提交即梦任务")

    mode = "omni_reference" if references else "text_to_video"
    output_dir.mkdir(parents=True, exist_ok=True)
    arguments = [
        *command,
        "video",
        "generate",
        "--mode",
        mode,
        "--model",
        model,
        "--region",
        region,
        "--prompt",
        prompt,
        "--ratio",
        ratio,
        "--resolution",
        "720p",
        "--duration",
        str(max(4, min(duration, 15))),
        "--wait",
        "--json",
        "--output-dir",
        str(output_dir.resolve()),
    ]
    for reference in references:
        arguments.extend(["--image-file", str(reference)])

    creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    process = await asyncio.create_subprocess_exec(
        *arguments,
        cwd=str(Path(__file__).resolve().parent.parent),
        env={**os.environ, "NO_COLOR": "1"},
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        creationflags=creation_flags,
    )

    communicate_task = asyncio.create_task(process.communicate())
    deadline = time.monotonic() + max(timeout_seconds, 1)
    try:
        while True:
            check_cancellation(cancellation_check)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise asyncio.TimeoutError()
            done, _ = await asyncio.wait({communicate_task}, timeout=min(1.0, remaining))
            if done:
                stdout, stderr = communicate_task.result()
                break
    except asyncio.TimeoutError as exc:
        if process.returncode is None:
            process.kill()
        await communicate_task
        raise JimengCliError("即梦 CLI 生成超时") from exc
    except Exception:
        if process.returncode is None:
            process.kill()
        await communicate_task
        raise

    stdout_text = stdout.decode("utf-8", errors="replace")
    stderr_text = stderr.decode("utf-8", errors="replace")
    if process.returncode != 0:
        message = (stderr_text or stdout_text).strip().splitlines()
        detail = message[-1] if message else "未知错误"
        raise JimengCliError(f"即梦 CLI 生成失败：{detail[:400]}")

    result = parse_json_output(stdout_text)
    files = collect_files(result)
    video_url = find_first_url(result)
    if not video_url and public_root:
        for file_name in files:
            file_path = Path(file_name)
            if not file_path.is_absolute():
                file_path = output_dir / file_path
            if file_path.is_file():
                video_url = file_to_public_url(file_path, public_root, public_url_prefix)
                if video_url:
                    break

    if not video_url:
        raise JimengCliError("即梦 CLI 已结束，但结果中没有视频地址")
    return JimengCliResult(video_url=video_url, files=files)

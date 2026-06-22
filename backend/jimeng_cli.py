import asyncio
import json
import os
import shutil
import subprocess
import time
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


@dataclass
class JimengFailureDetails:
    category: str
    title: str
    detail: str
    reason: Optional[str] = None
    submit_id: Optional[str] = None
    log_id: Optional[str] = None


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

    return {
        "available": bool(command),
        "command": " ".join(command) if command else None,
        "officialCliAvailable": bool(resolve_dreamina_command()),
        "legacyCliAvailable": bool(resolve_legacy_cli_command()),
        "tokenPoolConfigured": token_count > 0,
        "tokenCount": token_count,
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


async def run_cli_json(command: list[str], timeout_seconds: int = 120) -> Any:
    creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    process = await asyncio.create_subprocess_exec(
        *command,
        cwd=str(Path(__file__).resolve().parent.parent),
        env={**os.environ, "NO_COLOR": "1"},
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        creationflags=creation_flags,
    )

    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout_seconds)
    except asyncio.TimeoutError as exc:
        process.kill()
        await process.communicate()
        raise JimengCliError("即梦 CLI 命令超时") from exc

    stdout_text = stdout.decode("utf-8", errors="replace")
    stderr_text = stderr.decode("utf-8", errors="replace")
    if process.returncode != 0:
        message = (stderr_text or stdout_text).strip().splitlines()
        detail = message[-1] if message else "未知错误"
        raise JimengCliError(f"即梦 CLI 命令失败：{detail[:400]}")

    return parse_json_value(stdout_text)


async def get_account_snapshot(task_limit: int = 10) -> dict[str, Any]:
    command = resolve_dreamina_command()
    status = cli_public_status()
    snapshot: dict[str, Any] = {
        "cli": status,
        "account": None,
        "version": None,
        "tasks": [],
        "summary": {
            "totalTasks": 0,
            "successTasks": 0,
            "failedTasks": 0,
            "recentCreditUsed": 0,
        },
        "error": None,
    }

    if not command:
        snapshot["error"] = "未找到官方 dreamina CLI"
        return snapshot

    try:
        version = await run_cli_json([*command, "version"], timeout_seconds=30)
        account = await run_cli_json([*command, "user_credit"], timeout_seconds=60)
        tasks = await run_cli_json([*command, "list_task", f"--limit={task_limit}"], timeout_seconds=90)
        if not isinstance(tasks, list):
            tasks = []

        snapshot["version"] = version
        snapshot["account"] = account
        normalized_tasks = [task for task in tasks if isinstance(task, dict)]
        snapshot["tasks"] = normalized_tasks
        snapshot["summary"] = {
            "totalTasks": len(normalized_tasks),
            "successTasks": len([task for task in normalized_tasks if task.get("gen_status") == "success"]),
            "failedTasks": len([task for task in normalized_tasks if task.get("gen_status") == "fail"]),
            "recentCreditUsed": sum(
                int(((task.get("commerce_info") or {}).get("credit_count") or 0))
                for task in normalized_tasks
            ),
        }
    except JimengCliError as exc:
        snapshot["error"] = str(exc)

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


async def query_dreamina_result(command: list[str], submit_id: str, output_dir: Path) -> Any:
    return await run_cli_json(
        [*command, "query_result", f"--submit_id={submit_id}", "--download_dir", str(output_dir.resolve())],
        timeout_seconds=180,
    )


async def refresh_active_task_status(command: list[str], submit_id: str, output_dir: Path) -> Optional[str]:
    try:
        result = await query_dreamina_result(command, submit_id, output_dir)
    except JimengCliError:
        return None
    return find_generation_status(result)


async def wait_for_account_generation_slot(command: list[str], timeout_seconds: int, output_dir: Path) -> None:
    deadline = time.monotonic() + max(timeout_seconds, 1)
    check_dir = output_dir / "_slot_checks"
    check_dir.mkdir(parents=True, exist_ok=True)

    while True:
        tasks = await run_cli_json([*command, "list_task", "--limit=20"], timeout_seconds=90)
        active_tasks = [
            task for task in tasks
            if isinstance(task, dict) and is_active_generation_status(str(task.get("gen_status") or task.get("status") or ""))
        ] if isinstance(tasks, list) else []

        if not active_tasks:
            return

        for task in active_tasks[:3]:
            submit_id = task.get("submit_id") or task.get("submitId") or task.get("task_id") or task.get("taskId")
            if submit_id:
                await refresh_active_task_status(command, str(submit_id), check_dir)

        tasks = await run_cli_json([*command, "list_task", "--limit=20"], timeout_seconds=90)
        active_tasks = [
            task for task in tasks
            if isinstance(task, dict) and is_active_generation_status(str(task.get("gen_status") or task.get("status") or ""))
        ] if isinstance(tasks, list) else []

        if not active_tasks:
            return

        if time.monotonic() >= deadline:
            active_ids = [
                str(task.get("submit_id") or task.get("submitId") or task.get("task_id") or task.get("taskId") or "unknown")
                for task in active_tasks[:3]
            ]
            raise JimengCliError(
                f"即梦账号仍有任务占用生成通道：{', '.join(active_ids)}",
                failure_category="account",
                failure_title="即梦账号并发受限",
                failure_reason="active_task_timeout",
                failure_detail="即梦账号已有任务长时间处于排队或生成中，暂时不能提交新的分镜。",
            )

        await asyncio.sleep(max(DREAMINA_CLI_SLOT_CHECK_INTERVAL_SECONDS, 5))


async def poll_dreamina_result(
    *,
    command: list[str],
    submit_id: str,
    output_dir: Path,
    public_root: Optional[Path],
    public_url_prefix: str,
    timeout_seconds: int,
    initial_result: Any = None,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> JimengCliResult:
    deadline = time.monotonic() + max(timeout_seconds, 1)
    latest_result = initial_result
    latest_files: list[str] = []

    while True:
        if latest_result is None:
            latest_result = await query_dreamina_result(command, submit_id, output_dir)

        status = find_generation_status(latest_result)
        queue_info = extract_queue_info(latest_result)
        emit_progress(progress_callback, {
            "submitId": submit_id,
            "status": status,
            "queueInfo": queue_info,
        })
        files = collect_files(latest_result)
        latest_files = files or latest_files
        video_url = result_to_video_url(latest_result, output_dir, public_root, public_url_prefix)
        if video_url:
            return JimengCliResult(video_url=video_url, files=latest_files)

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

        await asyncio.sleep(max(DREAMINA_CLI_POLL_INTERVAL_SECONDS, 5))
        latest_result = await query_dreamina_result(command, submit_id, output_dir)


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
) -> JimengCliResult:
    command = resolve_dreamina_command()
    if not command:
        raise JimengCliError("未找到官方 dreamina CLI")

    references = [path.resolve() for path in reference_paths]
    output_dir.mkdir(parents=True, exist_ok=True)
    clipped_duration = str(max(4, min(duration, 15)))
    model_version = normalize_model_version(model)
    await wait_for_account_generation_slot(command, timeout_seconds, output_dir)

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

    result = await run_cli_json(arguments, timeout_seconds=300)
    submit_id = find_submit_id(result)
    status = find_generation_status(result)
    emit_progress(progress_callback, {
        "submitId": submit_id,
        "status": status,
        "queueInfo": extract_queue_info(result),
    })
    video_url = result_to_video_url(result, output_dir, public_root, public_url_prefix)
    files = collect_files(result)

    if submit_id and not video_url:
        try:
            query_result = await query_dreamina_result(command, submit_id, output_dir)
            query_status = find_generation_status(query_result)
            if is_active_generation_status(query_status) or is_success_generation_status(query_status):
                return await poll_dreamina_result(
                    command=command,
                    submit_id=submit_id,
                    output_dir=output_dir,
                    public_root=public_root,
                    public_url_prefix=public_url_prefix,
                    timeout_seconds=timeout_seconds,
                    initial_result=query_result,
                    progress_callback=progress_callback,
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
            submit_id=submit_id,
            output_dir=output_dir,
            public_root=public_root,
            public_url_prefix=public_url_prefix,
            timeout_seconds=timeout_seconds,
            initial_result=result,
            progress_callback=progress_callback,
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

    return JimengCliResult(video_url=video_url, files=files)


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
) -> JimengCliResult:
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

    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout_seconds)
    except asyncio.TimeoutError as exc:
        process.kill()
        await process.communicate()
        raise JimengCliError("即梦 CLI 生成超时") from exc

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

import asyncio
import json
import os
import shutil
import subprocess
from urllib.parse import quote
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional


class JimengCliError(RuntimeError):
    pass


@dataclass
class JimengCliResult:
    video_url: str
    files: list[str]


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
) -> JimengCliResult:
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
            str(timeout_seconds),
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
            str(timeout_seconds),
        ]

    result = await run_cli_json(arguments, timeout_seconds=timeout_seconds + 60)
    submit_id = find_submit_id(result)
    status = find_generation_status(result)
    video_url = result_to_video_url(result, output_dir, public_root, public_url_prefix)
    files = collect_files(result)

    if submit_id and not video_url and status in {None, "success", "done", "completed"}:
        query_result = await run_cli_json(
            [*command, "query_result", f"--submit_id={submit_id}", "--download_dir", str(output_dir.resolve())],
            timeout_seconds=180,
        )
        video_url = result_to_video_url(query_result, output_dir, public_root, public_url_prefix)
        files = collect_files(query_result) or files
        result = query_result
        status = find_generation_status(result)

    if status in {"fail", "failed", "error"}:
        raise JimengCliError(f"即梦 CLI 生成失败：{json.dumps(result, ensure_ascii=False)[:400]}")
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
    timeout_seconds: int = 1800,
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

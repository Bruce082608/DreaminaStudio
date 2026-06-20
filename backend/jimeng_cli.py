import asyncio
import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional


class JimengCliError(RuntimeError):
    pass


@dataclass
class JimengCliResult:
    video_url: str
    files: list[str]


def resolve_cli_command() -> Optional[list[str]]:
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
    command = resolve_cli_command()
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
        "tokenPoolConfigured": token_count > 0,
        "tokenCount": token_count,
    }


def parse_json_output(output: str) -> dict[str, Any]:
    decoder = json.JSONDecoder()
    parsed_objects = []
    for index, character in enumerate(output):
        if character != "{":
            continue
        try:
            value, _ = decoder.raw_decode(output[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            parsed_objects.append(value)

    if not parsed_objects:
        raise JimengCliError("即梦 CLI 未返回可解析的 JSON 结果")
    return parsed_objects[-1]


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
    if not isinstance(value, dict):
        return []
    data = value.get("data")
    if isinstance(data, dict) and isinstance(data.get("files"), list):
        return [str(item) for item in data["files"] if isinstance(item, str)]
    if isinstance(value.get("files"), list):
        return [str(item) for item in value["files"] if isinstance(item, str)]
    return []


async def generate_video(
    *,
    prompt: str,
    duration: int,
    ratio: str,
    model: str,
    region: str,
    output_dir: Path,
    reference_paths: Iterable[Path] = (),
    timeout_seconds: int = 1800,
) -> JimengCliResult:
    command = resolve_cli_command()
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
    video_url = find_first_url(result)
    if not video_url:
        raise JimengCliError("即梦 CLI 已结束，但结果中没有视频地址")
    return JimengCliResult(video_url=video_url, files=collect_files(result))

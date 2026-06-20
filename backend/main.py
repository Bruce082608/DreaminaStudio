import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import random
import secrets
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from fastapi import BackgroundTasks, Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.encoders import jsonable_encoder
from fastapi.staticfiles import StaticFiles
import httpx
from pydantic import BaseModel, Field

try:
    from .jimeng_cli import JimengCliError, cli_public_status, generate_video, get_account_snapshot
    from . import billing
    from .billing import (
        BillingOverview,
        CreditTransaction,
        FIRST_REGISTER_BONUS_CREDITS,
        RechargePackage,
        RechargePayload,
    )
except ImportError:
    from jimeng_cli import JimengCliError, cli_public_status, generate_video, get_account_snapshot
    import billing
    from billing import (
        BillingOverview,
        CreditTransaction,
        FIRST_REGISTER_BONUS_CREDITS,
        RechargePackage,
        RechargePayload,
    )

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("dreamina_backend")

app = FastAPI(
    title="Dreamina Studio Backend",
    description="Queue-based backend for Dreamina Studio with cookie pool routing and video generation.",
    version="1.0.0"
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# Models & Schemas
# ==========================================

class Cookie(BaseModel):
    id: str
    alias: str
    value: str
    status: str = "active"  # active, expired, rate_limited
    activeTasks: int = Field(default=0, alias="activeTasks")
    failCount: int = Field(default=0, alias="failCount")

    class Config:
        populate_by_name = True

class Character(BaseModel):
    id: str
    name: str
    basePrompt: str
    avatar: Optional[str] = None
    gender: str

class Shot(BaseModel):
    id: str
    characterIds: List[str] = Field(default_factory=list)
    prompt: str
    duration: int = 8
    engine: str = "jimeng"
    status: str = "idle"  # idle, waiting, generating, completed, failed
    progress: int = 0
    videoUrl: Optional[str] = None
    caption: Optional[str] = None
    error: Optional[str] = None

class CompileParams(BaseModel):
    bgm: str = "lofi"
    bgmVolume: int = 30
    voiceVolume: int = 80
    totalDuration: int = 60
    shotIds: List[str]

class UserRecord(BaseModel):
    id: str
    name: str
    email: str
    passwordHash: str
    role: str = "user"
    status: str = "active"
    creditBalance: int = FIRST_REGISTER_BONUS_CREDITS
    rechargeCount: int = 0
    lifetimeRechargeCny: float = 0
    createdAt: float
    lastLoginAt: Optional[float] = None
    loginCount: int = 0

class PublicUser(BaseModel):
    id: str
    name: str
    email: str
    role: str
    status: str
    creditBalance: int = 0
    rechargeCount: int = 0
    lifetimeRechargeCny: float = 0
    createdAt: float
    lastLoginAt: Optional[float] = None
    loginCount: int = 0

class AuthPayload(BaseModel):
    email: str
    password: str

class RegisterPayload(AuthPayload):
    name: str

class AuthResponse(BaseModel):
    token: str
    user: PublicUser

class AgentSettings(BaseModel):
    deepseekBaseUrl: str = "https://api.deepseek.com"
    deepseekModel: str = "deepseek-v4-flash"
    deepseekApiKey: Optional[str] = None
    jimengMode: str = "cli"
    jimengApiUrl: Optional[str] = None
    jimengModel: str = "seedance2.0fast"
    jimengRegion: str = "cn"
    updatedAt: Optional[float] = None

class AgentSettingsUpdate(BaseModel):
    deepseekBaseUrl: str = "https://api.deepseek.com"
    deepseekModel: str = "deepseek-v4-flash"
    deepseekApiKey: Optional[str] = None
    jimengMode: str = "cli"
    jimengApiUrl: Optional[str] = None
    jimengModel: str = "seedance2.0fast"
    jimengRegion: str = "cn"

class AgentSettingsPublic(BaseModel):
    deepseekBaseUrl: str
    deepseekModel: str
    deepseekApiKeySet: bool
    jimengMode: str
    jimengApiUrl: Optional[str] = None
    jimengModel: str
    jimengRegion: str
    jimengCliAvailable: bool = False
    jimengTokenPoolConfigured: bool = False
    updatedAt: Optional[float] = None

class AgentCreatePayload(BaseModel):
    idea: str
    duration: int = Field(default=180, ge=15, le=600)
    segmentDuration: int = Field(default=10, ge=4, le=15)
    style: str = "电影感"
    ratio: str = "16:9"
    jimengModel: str = "seedance2.0fast"
    imageNames: List[str] = Field(default_factory=list)
    imageIds: List[str] = Field(default_factory=list, max_length=9)

class AgentRunScene(BaseModel):
    id: str
    number: str
    time: str
    title: str
    prompt: str
    duration: int
    status: str = "queued"
    progress: int = 0
    videoUrl: Optional[str] = None
    error: Optional[str] = None

class AgentStoryboardCandidate(BaseModel):
    id: str
    title: str
    summary: str
    scenes: List[AgentRunScene] = Field(default_factory=list)

class AgentSceneEdit(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    prompt: str = Field(min_length=10, max_length=8000)
    duration: int = Field(ge=4, le=15)

class AgentConfirmPayload(BaseModel):
    candidateId: str
    scenes: List[AgentSceneEdit] = Field(min_length=1, max_length=150)

class AgentUploadResponse(BaseModel):
    id: str
    name: str

class AgentRun(BaseModel):
    id: str
    userId: str
    userEmail: str
    status: str = "queued"
    stage: str = "queued"
    progress: int = 0
    idea: str
    duration: int
    segmentDuration: int = 10
    style: str
    ratio: str
    jimengModel: str = "seedance2.0fast"
    estimatedCreditCost: int = 0
    creditCost: int = 0
    creditChargedAt: Optional[float] = None
    imageNames: List[str] = Field(default_factory=list)
    imageIds: List[str] = Field(default_factory=list)
    candidates: List[AgentStoryboardCandidate] = Field(default_factory=list)
    selectedCandidateId: Optional[str] = None
    scenes: List[AgentRunScene] = Field(default_factory=list)
    finalVideoUrl: Optional[str] = None
    error: Optional[str] = None
    agentModel: str = "deepseek-v4-flash"
    createdAt: float
    updatedAt: float

class UploadedReference(BaseModel):
    id: str
    userId: str
    name: str
    path: str

# ==========================================
# In-Memory Database / State
# ==========================================

cookie_pool: Dict[str, Cookie] = {
    "cookie-1": Cookie(
        id="cookie-1",
        alias="主账号_VIP (即梦)",
        value="sessionid_ss=vip_cookie_hash_01_a9f3b...",
        status="active",
        activeTasks=0,
        failCount=0
    ),
    "cookie-2": Cookie(
        id="cookie-2",
        alias="备用号_01 (即梦)",
        value="sessionid_ss=free_cookie_hash_02_bc482...",
        status="active",
        activeTasks=0,
        failCount=0
    )
}

shots_db: Dict[str, Shot] = {}
task_queue: asyncio.Queue = asyncio.Queue()
active_workers = []
agent_runs: Dict[str, AgentRun] = {}
uploaded_references: Dict[str, UploadedReference] = {}
DATA_DIR = Path(__file__).resolve().parent / "data"
USERS_FILE = DATA_DIR / "users.json"
SETTINGS_FILE = DATA_DIR / "agent_settings.json"
TRANSACTIONS_FILE = DATA_DIR / "credit_transactions.json"
UPLOADS_DIR = DATA_DIR / "uploads"
OUTPUTS_DIR = DATA_DIR / "outputs"
DEFAULT_ADMIN_EMAIL = os.getenv("DREAMINA_ADMIN_EMAIL", "admin@dreamina.local").lower()
DEFAULT_ADMIN_PASSWORD = os.getenv("DREAMINA_ADMIN_PASSWORD", "Dreamina@2026")
AUTH_SECRET = os.getenv("DREAMINA_AUTH_SECRET", "dreamina-studio-local-dev-secret")

OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/outputs", StaticFiles(directory=str(OUTPUTS_DIR)), name="outputs")

SUPPORTED_JIMENG_MODELS = {
    "seedance2.0",
    "seedance2.0fast",
    "seedance2.0_vip",
    "seedance2.0fast_vip",
    "seedance2.0mini",
}

JIMENG_MODEL_ALIASES = {
    "jimeng-video-seedance-2.0": "seedance2.0",
    "jimeng-video-seedance-2.0-fast": "seedance2.0fast",
    "jimeng-video-seedance-2.0-vip": "seedance2.0_vip",
    "jimeng-video-seedance-2.0-fast-vip": "seedance2.0fast_vip",
}

# Mock Video URLs
MOCK_VIDEOS = [
    "https://assets.mixkit.co/videos/preview/mixkit-barista-pouring-milk-into-a-cup-of-coffee-41617-large.mp4",
    "https://assets.mixkit.co/videos/preview/mixkit-pouring-hot-water-into-a-chemex-41712-large.mp4",
    "https://assets.mixkit.co/videos/preview/mixkit-steaming-cup-of-coffee-close-up-41713-large.mp4",
    "https://assets.mixkit.co/videos/preview/mixkit-freshly-brewed-coffee-dripping-into-a-pot-41714-large.mp4"
]
MOCK_GENERATION_STEP_SECONDS = float(os.getenv("DREAMINA_MOCK_STEP_SECONDS", "0.4"))
MOCK_GENERATION_ERROR_RATE = float(os.getenv("DREAMINA_MOCK_ERROR_RATE", "0"))

# ==========================================
# User Auth Helpers
# ==========================================

def hash_password(password: str, salt: Optional[str] = None) -> str:
    salt = salt or secrets.token_hex(16)
    iterations = 120000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations)
    encoded_digest = base64.b64encode(digest).decode("ascii")
    return f"pbkdf2_sha256${iterations}${salt}${encoded_digest}"

def verify_password(password: str, password_hash: str) -> bool:
    try:
        algorithm, iterations, salt, expected_digest = password_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("utf-8"),
            int(iterations),
        )
        actual_digest = base64.b64encode(digest).decode("ascii")
        return secrets.compare_digest(actual_digest, expected_digest)
    except ValueError:
        return False

def encode_base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")

def decode_base64url(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(f"{value}{padding}")

def create_auth_token(email: str) -> str:
    payload = {
        "email": email.lower(),
        "iat": time.time(),
        "nonce": secrets.token_hex(8),
    }
    encoded_payload = encode_base64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(AUTH_SECRET.encode("utf-8"), encoded_payload.encode("ascii"), hashlib.sha256).digest()
    return f"{encoded_payload}.{encode_base64url(signature)}"

def parse_auth_token(token: str) -> str:
    try:
        encoded_payload, encoded_signature = token.split(".", 1)
        expected_signature = hmac.new(
            AUTH_SECRET.encode("utf-8"),
            encoded_payload.encode("ascii"),
            hashlib.sha256,
        ).digest()
        actual_signature = decode_base64url(encoded_signature)
        if not hmac.compare_digest(actual_signature, expected_signature):
            raise ValueError("Invalid signature")

        payload = json.loads(decode_base64url(encoded_payload).decode("utf-8"))
        return str(payload["email"]).lower()
    except (KeyError, ValueError, json.JSONDecodeError):
        raise HTTPException(status_code=401, detail="Invalid or expired session") from None

def user_to_public(user: UserRecord) -> PublicUser:
    return PublicUser(**user.model_dump(exclude={"passwordHash"}))

def load_users() -> Dict[str, UserRecord]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not USERS_FILE.exists():
        return {}

    with USERS_FILE.open("r", encoding="utf-8-sig") as file:
        raw_users = json.load(file)

    return {email.lower(): UserRecord(**data) for email, data in raw_users.items()}

def save_users(users: Dict[str, UserRecord]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    serialized = {email: jsonable_encoder(user) for email, user in users.items()}
    with USERS_FILE.open("w", encoding="utf-8") as file:
        json.dump(serialized, file, ensure_ascii=False, indent=2)

def load_credit_transactions() -> List[CreditTransaction]:
    return billing.load_credit_transactions(TRANSACTIONS_FILE)

def save_credit_transactions(transactions: List[CreditTransaction]) -> None:
    billing.save_credit_transactions(TRANSACTIONS_FILE, transactions)

def append_credit_transaction(transaction: CreditTransaction) -> None:
    billing.append_credit_transaction(TRANSACTIONS_FILE, transaction)

def user_has_recharged(user: UserRecord) -> bool:
    return billing.user_has_recharged(user, TRANSACTIONS_FILE)

def create_credit_transaction(
    user: UserRecord,
    transaction_type: str,
    amount: int,
    balance_after: int,
    description: str,
    *,
    package_id: Optional[str] = None,
    run_id: Optional[str] = None,
    price_cny: Optional[float] = None,
    original_price_cny: Optional[float] = None,
) -> CreditTransaction:
    return billing.create_credit_transaction(
        user,
        transaction_type,
        amount,
        balance_after,
        description,
        package_id=package_id,
        run_id=run_id,
        price_cny=price_cny,
        original_price_cny=original_price_cny,
    )

def get_user_transactions(user: UserRecord, limit: int = 20) -> List[CreditTransaction]:
    return billing.get_user_transactions(user, TRANSACTIONS_FILE, limit=limit)

def get_recharge_package(package_id: str) -> RechargePackage:
    return billing.get_recharge_package(package_id)

def calculate_video_credit_cost(model: str, durations: List[int]) -> int:
    return billing.calculate_video_credit_cost(model, durations, normalize_jimeng_model)

def recharge_user_credits(email: str, package_id: str) -> CreditTransaction:
    users = load_users()
    transaction = billing.apply_recharge(users, email, package_id, TRANSACTIONS_FILE)
    save_users(users)
    return transaction

def charge_user_credits(email: str, amount: int, description: str, run_id: Optional[str] = None) -> CreditTransaction:
    users = load_users()
    transaction = billing.apply_debit(users, email, amount, description, TRANSACTIONS_FILE, run_id=run_id)
    save_users(users)
    return transaction

def ensure_default_admin() -> None:
    users = load_users()
    if DEFAULT_ADMIN_EMAIL in users:
        return

    users[DEFAULT_ADMIN_EMAIL] = UserRecord(
        id=f"user-{secrets.token_hex(8)}",
        name="Dreamina 管理员",
        email=DEFAULT_ADMIN_EMAIL,
        passwordHash=hash_password(DEFAULT_ADMIN_PASSWORD),
        role="admin",
        status="active",
        creditBalance=FIRST_REGISTER_BONUS_CREDITS,
        createdAt=time.time(),
    )
    save_users(users)
    append_credit_transaction(create_credit_transaction(
        users[DEFAULT_ADMIN_EMAIL],
        "bonus",
        FIRST_REGISTER_BONUS_CREDITS,
        FIRST_REGISTER_BONUS_CREDITS,
        "首次注册赠送积分",
    ))
    logger.info("Default admin user created: %s", DEFAULT_ADMIN_EMAIL)

def get_current_user(authorization: Optional[str] = Header(default=None)) -> UserRecord:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authentication token")

    token = authorization.removeprefix("Bearer ").strip()
    email = parse_auth_token(token)

    user = load_users().get(email)
    if not user or user.status != "active":
        raise HTTPException(status_code=401, detail="User is not active")

    return user

def require_admin(current_user: UserRecord = Depends(get_current_user)) -> UserRecord:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user

def load_agent_settings() -> AgentSettings:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not SETTINGS_FILE.exists():
        return AgentSettings(deepseekApiKey=os.getenv("DEEPSEEK_API_KEY"))

    with SETTINGS_FILE.open("r", encoding="utf-8-sig") as file:
        settings = AgentSettings(**json.load(file))
    if not settings.deepseekApiKey:
        settings.deepseekApiKey = os.getenv("DEEPSEEK_API_KEY")
    return settings

def save_agent_settings(settings: AgentSettings) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with SETTINGS_FILE.open("w", encoding="utf-8") as file:
        json.dump(jsonable_encoder(settings), file, ensure_ascii=False, indent=2)

def normalize_jimeng_model(model: str) -> str:
    normalized = (model or "").strip()
    normalized = JIMENG_MODEL_ALIASES.get(normalized, normalized)
    if normalized not in SUPPORTED_JIMENG_MODELS:
        raise HTTPException(status_code=400, detail="不支持的即梦模型")
    return normalized

def agent_settings_to_public(settings: AgentSettings) -> AgentSettingsPublic:
    cli_status = cli_public_status()
    jimeng_model = JIMENG_MODEL_ALIASES.get(settings.jimengModel, settings.jimengModel)
    if jimeng_model not in SUPPORTED_JIMENG_MODELS:
        jimeng_model = "seedance2.0fast"
    return AgentSettingsPublic(
        deepseekBaseUrl=settings.deepseekBaseUrl,
        deepseekModel=settings.deepseekModel,
        deepseekApiKeySet=bool(settings.deepseekApiKey),
        jimengMode=settings.jimengMode,
        jimengApiUrl=settings.jimengApiUrl,
        jimengModel=jimeng_model,
        jimengRegion=settings.jimengRegion,
        jimengCliAvailable=cli_status["available"],
        jimengTokenPoolConfigured=cli_status["tokenPoolConfigured"],
        updatedAt=settings.updatedAt,
    )

def format_time(seconds: int) -> str:
    minutes = seconds // 60
    remaining_seconds = seconds % 60
    return f"{minutes}:{remaining_seconds:02d}"

def get_scene_durations(payload: AgentCreatePayload) -> List[int]:
    count = max((payload.duration + payload.segmentDuration - 1) // payload.segmentDuration, 1)
    durations = [payload.segmentDuration] * count
    durations[-1] = payload.duration - payload.segmentDuration * (count - 1)
    if len(durations) > 1 and durations[-1] < 4:
        combined = durations[-2] + durations[-1]
        durations[-2] = combined // 2
        durations[-1] = combined - durations[-2]
    return durations

def fallback_candidates(payload: AgentCreatePayload, run_id: str) -> List[AgentStoryboardCandidate]:
    titles = [
        "开场氛围建立",
        "主角动机显现",
        "关键线索出现",
        "空间关系推进",
        "情绪转折",
        "动作段落展开",
        "冲突升级",
        "视觉高潮",
        "尾声与回响",
    ]
    direction = "强调叙事清晰、镜头连续、动作可执行和情绪递进"
    scenes = []
    start = 0
    for scene_index, scene_duration in enumerate(get_scene_durations(payload)):
        end = start + scene_duration
        reference_note = (
            "使用上传参考图保持人物一致，不描述人物衣物服装。"
            if payload.imageIds
            else "完整描述人物外观、环境和关键视觉特征。"
        )
        scenes.append(
            AgentRunScene(
                id=f"{run_id}-c1-scene-{scene_index + 1}",
                number=str(scene_index + 1).zfill(2),
                time=f"{format_time(start)} - {format_time(end)}",
                title=titles[scene_index % len(titles)],
                duration=scene_duration,
                prompt=(
                    f"{payload.style}式分镜，{payload.ratio}，{direction}。{reference_note}"
                    f"本段必须独立描述画面主体、动作或对话、环境、光线、情绪和运镜。"
                    f"剧本内容：{payload.idea}"
                ),
            )
        )
        start = end
    return [
        AgentStoryboardCandidate(
            id=f"{run_id}-candidate-1",
            title="分镜剧本",
            summary=direction,
            scenes=scenes,
        )
    ]

def extract_json_object(text: str) -> Dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("Agent response did not contain JSON")

    json_text = cleaned[start : end + 1]
    try:
        return json.loads(json_text)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"分镜生成服务返回了非严格 JSON：{exc.msg}，位置 line {exc.lineno} column {exc.colno}"
        ) from exc

def build_storyboard_prompt(payload: AgentCreatePayload) -> str:
    scene_durations = get_scene_durations(payload)
    reference_rule = (
        "有参考图片。不要对人物进行任何衣物、服装、配饰上的描述；"
        "只需用‘参考图中的人物’指代，并保持人物一致。"
        if payload.imageIds
        else "没有参考图片，需要完整描述人物的稳定视觉特征。"
    )
    return f"""【基础设定】
我将使用即梦{payload.jimengModel}模型制作一个总长{payload.duration}秒的分段长视频，请你按照要求生成详细的提示词剧本，并可适当补充细节（人物对话、人物动作等，但必须包含我说的内容）。

【画面分镜风格】
使用{payload.style}式的分镜剧本，画幅为{payload.ratio}。{reference_rule}
每一段分镜目标时长为{payload.segmentDuration}秒，本次各段实际时长依次为：{scene_durations}秒。
需要考虑到视频生成模型无法看到上一段提示词，所以每一段之间应完全独立描述，重复写清人物、场景、时间、光线和必要的连续性信息。如有角色，则在剧本中跟随角色的动作或对话描述运镜。

【剧本描述】
{payload.idea}

【方案方向】
生成一套叙事清晰、镜头连续、动作可执行、适合用户继续修改的分镜剧本。

只输出 JSON，不要输出 Markdown 或解释。JSON 格式：
{{"title":"分镜剧本标题","summary":"一句话说明本方案特点","scenes":[{{"title":"分镜标题","prompt":"可直接提交给即梦 Seedance 2.0 的完整独立提示词"}}]}}
scenes 必须严格输出 {len(scene_durations)} 段。
JSON 字符串内部禁止使用未转义的英文双引号；人物对话请使用中文引号「」或中文冒号，避免破坏 JSON。"""

async def repair_storyboard_json(
    client: httpx.AsyncClient,
    settings: AgentSettings,
    invalid_content: str,
    parse_error: Exception,
    expected_scene_count: int,
) -> Dict[str, Any]:
    repair_prompt = f"""下面是一段分镜生成服务返回的 JSON，但它不是严格合法 JSON。
请只修复 JSON 语法，不要改写分镜内容，不要新增或删除字段，不要输出 Markdown。

要求：
1. 输出必须是一个合法 JSON object。
2. 顶层必须包含 title、summary、scenes。
3. scenes 必须严格保留 {expected_scene_count} 段。
4. JSON 字符串内部如果有对话，使用中文引号「」或正确转义英文双引号。

解析错误：
{parse_error}

待修复内容：
{invalid_content}
"""
    response = await client.post(
        f"{settings.deepseekBaseUrl.rstrip('/')}/chat/completions",
        headers={
            "Authorization": f"Bearer {settings.deepseekApiKey}",
            "Content-Type": "application/json",
        },
        json={
            "model": settings.deepseekModel,
            "messages": [
                {
                    "role": "system",
                    "content": "你是严格的 JSON 修复器。只输出可被 json.loads 解析的合法 JSON object。",
                },
                {"role": "user", "content": repair_prompt},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0,
            "stream": False,
        },
    )
    response.raise_for_status()
    repaired_content = response.json()["choices"][0]["message"]["content"]
    return extract_json_object(repaired_content)

async def plan_storyboard_candidate(
    payload: AgentCreatePayload,
    run_id: str,
    settings: AgentSettings,
) -> AgentStoryboardCandidate:
    if not settings.deepseekApiKey:
        raise RuntimeError("管理员尚未配置分镜生成服务")
    system_prompt = (
        "你是专业的视频分镜编剧。你只负责写详细、可编辑、可直接交给即梦 Seedance 2.0 的分镜剧本，"
        "不负责生成视频，也不执行任何外部工具。必须输出合法 JSON。"
    )

    scene_durations = get_scene_durations(payload)

    async with httpx.AsyncClient(timeout=180.0) as client:
        response = await client.post(
            f"{settings.deepseekBaseUrl.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.deepseekApiKey}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.deepseekModel,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": build_storyboard_prompt(payload)},
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.85,
                "stream": False,
            },
        )
        response.raise_for_status()
        data = response.json()

        content = data["choices"][0]["message"]["content"]
        try:
            planned = extract_json_object(content)
        except ValueError as exc:
            logger.warning(
                "Storyboard generator returned malformed JSON. Attempting repair: %s",
                exc,
            )
            planned = await repair_storyboard_json(
                client,
                settings,
                content,
                exc,
                len(scene_durations),
            )

    raw_scenes = planned.get("scenes") or []
    if len(raw_scenes) != len(scene_durations):
        raise RuntimeError(
            f"分镜生成服务返回了 {len(raw_scenes)} 段，预期 {len(scene_durations)} 段"
        )

    scenes = []
    start = 0
    for index, (scene, scene_duration) in enumerate(zip(raw_scenes, scene_durations)):
        end = start + scene_duration
        scenes.append(
            AgentRunScene(
                id=f"{run_id}-c1-scene-{index + 1}",
                number=str(index + 1).zfill(2),
                time=f"{format_time(start)} - {format_time(end)}",
                title=str(scene.get("title") or f"分镜 {index + 1}"),
                duration=scene_duration,
                prompt=str(scene.get("prompt") or "").strip(),
            )
        )
        start = end

    if any(len(scene.prompt) < 10 for scene in scenes):
        raise RuntimeError("分镜生成服务返回了空白或过短的分镜提示词")
    return AgentStoryboardCandidate(
        id=f"{run_id}-candidate-1",
        title=str(planned.get("title") or "分镜剧本"),
        summary=str(planned.get("summary") or "可编辑的 Seedance 2.0 分镜方案"),
        scenes=scenes,
    )

async def build_scene_plan(
    payload: AgentCreatePayload,
    run_id: str,
    settings: AgentSettings,
) -> tuple[List[AgentStoryboardCandidate], str]:
    if not settings.deepseekApiKey:
        if settings.jimengMode == "mock":
            return fallback_candidates(payload, run_id), "local-storyboard"
        raise RuntimeError("管理员尚未配置分镜生成服务")

    try:
        candidate = await plan_storyboard_candidate(payload, run_id, settings)
        return [candidate], settings.deepseekModel
    except Exception as exc:
        raise RuntimeError(f"分镜剧本生成失败：{exc}") from exc

def sync_run_from_shots(run: AgentRun) -> AgentRun:
    if not run.scenes:
        return run

    synced_scenes = []
    for scene in run.scenes:
        shot = shots_db.get(scene.id)
        if shot:
            scene.status = backend_status_to_agent_status(shot.status)
            scene.progress = shot.progress
            scene.videoUrl = shot.videoUrl
            scene.error = shot.error
        synced_scenes.append(scene)

    run.scenes = synced_scenes
    if run.status in {"generating", "completed"}:
        total_progress = sum(scene.progress for scene in run.scenes)
        scene_progress = round(total_progress / max(len(run.scenes), 1))
        run.progress = min(95, 20 + round(scene_progress * 0.75))
        if any(scene.status == "generating" for scene in run.scenes):
            run.stage = "jimeng_generating"
        if all(scene.status in {"completed", "failed"} for scene in run.scenes):
            completed_scenes = [scene for scene in run.scenes if scene.status == "completed" and scene.videoUrl]
            run.status = "completed" if completed_scenes else "failed"
            run.stage = "completed" if completed_scenes else "failed"
            run.progress = 100 if completed_scenes else run.progress
            run.finalVideoUrl = completed_scenes[0].videoUrl if completed_scenes else None
            if not completed_scenes:
                run.error = "所有即梦分镜任务均未成功生成"
    run.updatedAt = time.time()
    agent_runs[run.id] = run
    return run

def backend_status_to_agent_status(status: str) -> str:
    return {
        "idle": "queued",
        "waiting": "queued",
        "generating": "generating",
        "completed": "completed",
        "failed": "failed",
    }.get(status, status)

async def process_agent_run(run_id: str) -> None:
    run = agent_runs.get(run_id)
    if not run:
        return

    payload = AgentCreatePayload(
        idea=run.idea,
        duration=run.duration,
        segmentDuration=run.segmentDuration,
        style=run.style,
        ratio=run.ratio,
        jimengModel=run.jimengModel,
        imageNames=run.imageNames,
        imageIds=run.imageIds,
    )

    try:
        settings = load_agent_settings()
        run.status = "planning"
        run.stage = "storyboard_planning" if settings.deepseekApiKey else "local_planning"
        run.progress = 8
        run.updatedAt = time.time()
        agent_runs[run_id] = run

        candidates, planner_model = await build_scene_plan(payload, run_id, settings)
        run.agentModel = planner_model
        run.candidates = candidates
        run.status = "awaiting_confirmation"
        run.stage = "awaiting_confirmation"
        run.progress = 20
        run.updatedAt = time.time()
        agent_runs[run_id] = run
        logger.info("Agent run %s created %s editable storyboard candidates.", run_id, len(candidates))
    except Exception as exc:
        run.status = "failed"
        run.stage = "failed"
        run.error = str(exc)
        run.progress = 0
        run.updatedAt = time.time()
        agent_runs[run_id] = run
        logger.exception("Agent run %s failed: %s", run_id, exc)

def get_run_reference_paths(run: AgentRun) -> List[Path]:
    paths = []
    for image_id in run.imageIds:
        reference = uploaded_references.get(image_id)
        if reference and reference.userId == run.userId:
            paths.append(Path(reference.path))
    return paths

async def process_confirmed_run(run_id: str) -> None:
    run = agent_runs.get(run_id)
    if not run:
        return

    try:
        settings = load_agent_settings()
        reference_paths = get_run_reference_paths(run)
        run.status = "generating"
        run.stage = "jimeng_dispatch"
        run.progress = 20
        run.error = None
        run.updatedAt = time.time()

        for scene in run.scenes:
            shots_db[scene.id] = Shot(
                id=scene.id,
                prompt=scene.prompt,
                duration=scene.duration,
                engine="jimeng",
                status="waiting",
                progress=0,
                caption=f"{scene.title} / {run.ratio}",
            )
        agent_runs[run_id] = run

        for scene in run.scenes:
            shot = shots_db[scene.id]
            shot.status = "generating"
            shot.progress = 5
            run.stage = "jimeng_generating"
            run.updatedAt = time.time()
            sync_run_from_shots(run)

            try:
                if settings.jimengMode == "mock":
                    await simulate_video_generation(scene.id, None)
                elif settings.jimengMode == "cli":
                    reference_instruction = ""
                    if reference_paths:
                        slots = "、".join(f"@image_file_{index}" for index in range(1, len(reference_paths) + 1))
                        reference_instruction = f"使用参考图片 {slots} 保持角色与场景一致。"
                    result = await generate_video(
                        prompt=f"{reference_instruction}{scene.prompt}",
                        duration=scene.duration,
                        ratio=run.ratio,
                        model=run.jimengModel or settings.jimengModel,
                        region=settings.jimengRegion,
                        output_dir=OUTPUTS_DIR / run.id / scene.id,
                        reference_paths=reference_paths,
                        public_root=OUTPUTS_DIR,
                        public_url_prefix="/api/outputs",
                    )
                    shot.videoUrl = result.video_url
                    shot.progress = 100
                    shot.status = "completed"
                else:
                    raise RuntimeError(f"不支持的即梦接入模式：{settings.jimengMode}")
            except (JimengCliError, RuntimeError) as exc:
                shot.status = "failed"
                shot.progress = 0
                shot.error = str(exc)
                logger.exception("Jimeng scene %s failed: %s", scene.id, exc)

            sync_run_from_shots(run)

        sync_run_from_shots(run)
        logger.info("Agent run %s finished sequential Jimeng generation.", run_id)
    except Exception as exc:
        run.status = "failed"
        run.stage = "failed"
        run.error = str(exc)
        run.updatedAt = time.time()
        agent_runs[run_id] = run
        logger.exception("Confirmed Agent run %s failed: %s", run_id, exc)

# ==========================================
# Background Generation Worker
# ==========================================

async def simulate_video_generation(shot_id: str, cookie_id: Optional[str]):
    """
    Simulates the background video generation process, calling Douyin Jimeng API.
    Increments progress and marks success/failure depending on configuration.
    """
    try:
        shot = shots_db.get(shot_id)
        if not shot:
            return

        shot.status = "generating"
        shot.progress = 0
        shot.error = None
        
        total_steps = 10
        delay_per_step = max(MOCK_GENERATION_STEP_SECONDS, 0.01)

        # Simulate rendering progress
        for i in range(1, total_steps + 1):
            await asyncio.sleep(delay_per_step)
            shot.progress = int((i / total_steps) * 100)
            logger.info(f"Shot {shot_id} progress: {shot.progress}%")

        # Determine success/failure based on mock error rates
        error_rate = min(max(MOCK_GENERATION_ERROR_RATE, 0), 1)
        is_success = random.random() > error_rate

        if is_success:
            shot.status = "completed"
            shot.videoUrl = random.choice(MOCK_VIDEOS)
            shot.caption = shot.prompt.split(",")[-1].strip() if shot.prompt else "时光咖啡馆..."
            logger.info(f"Shot {shot_id} generated successfully. URL: {shot.videoUrl}")
            
            # Reset cookie fail count on success
            if cookie_id and cookie_id in cookie_pool:
                cookie_pool[cookie_id].failCount = 0
        else:
            shot.status = "failed"
            shot.progress = 0
            
            # Simulated error messages
            errors = {
                "jimeng": "即梦API并发超限，请稍后重试 (Concurrency Limit Exceeded)",
                "kling": "可灵上游服务器排队溢出，请求被自动熔断 (Queue Overflow)",
                "hunyuan": "CUDA Out of Memory: GPU VRAM Allocation Error"
            }
            shot.error = errors.get(shot.engine, "未知的网关上游响应异常")
            logger.error(f"Shot {shot_id} failed: {shot.error}")

            # Update cookie fail count
            if cookie_id and cookie_id in cookie_pool:
                c = cookie_pool[cookie_id]
                c.failCount += 1
                if c.failCount >= 3:
                    c.status = "expired"
                    logger.warning(f"Cookie [{c.alias}] has failed 3 times and is now marked EXPIRED.")

    except Exception as e:
        logger.error(f"Unexpected error in background generation: {e}")
        if shot_id in shots_db:
            shots_db[shot_id].status = "failed"
            shots_db[shot_id].error = str(e)
    finally:
        # Release the active task counter from the cookie
        if cookie_id and cookie_id in cookie_pool:
            cookie_pool[cookie_id].activeTasks = max(0, cookie_pool[cookie_id].activeTasks - 1)

async def queue_worker():
    """
    Asynchronous queue worker that continuously pulls tasks and routes them
    using healthy cookies from the cookie pool.
    """
    logger.info("Background queue worker started.")
    while True:
        try:
            shot_id = await task_queue.get()
            logger.info(f"Pulled shot {shot_id} from queue.")

            shot = shots_db.get(shot_id)
            if not shot:
                task_queue.task_done()
                continue

            # Assign cookie if engine is Jimeng
            assigned_cookie_id = None
            if shot.engine == "jimeng":
                while True:
                    active_cookies = [c for c in cookie_pool.values() if c.status == "active"]
                    available_cookies = [c for c in active_cookies if c.activeTasks < 2]

                    if available_cookies:
                        break

                    if not active_cookies:
                        shot.status = "failed"
                        shot.error = "逆向网关异常：即梦 Cookie 账号池无可用节点 (账号已失效)"
                        logger.warning(f"Failed to schedule shot {shot_id}: No healthy cookies available.")
                        task_queue.task_done()
                        break

                    logger.info(f"All Jimeng cookies are busy. Waiting to schedule shot {shot_id}.")
                    await asyncio.sleep(1)

                if shot.status == "failed":
                    continue
                
                # Pick the cookie with lowest current active load
                chosen_cookie = min(available_cookies, key=lambda c: c.activeTasks)
                chosen_cookie.activeTasks += 1
                assigned_cookie_id = chosen_cookie.id
                logger.info(f"Assigned Cookie [{chosen_cookie.alias}] to Shot {shot_id}")

            # Start video generation as a non-blocking background asyncio task
            asyncio.create_task(simulate_video_generation(shot_id, assigned_cookie_id))
            task_queue.task_done()
            
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Error in queue worker: {e}")
            await asyncio.sleep(1)

@app.on_event("startup")
async def startup_event():
    ensure_default_admin()
    # Start background task queue worker
    worker_task = asyncio.create_task(queue_worker())
    active_workers.append(worker_task)

@app.on_event("shutdown")
async def shutdown_event():
    for w in active_workers:
        w.cancel()
    await asyncio.gather(*active_workers, return_exceptions=True)

# ==========================================
# REST API Routes
# ==========================================

@app.post("/auth/register", response_model=AuthResponse)
def register_user(payload: RegisterPayload):
    email = payload.email.strip().lower()
    name = payload.name.strip()

    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Name must be at least 2 characters")
    if "@" not in email or "." not in email:
        raise HTTPException(status_code=400, detail="Please enter a valid email")
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    users = load_users()
    if email in users:
        raise HTTPException(status_code=400, detail="Email is already registered")

    user = UserRecord(
        id=f"user-{secrets.token_hex(8)}",
        name=name,
        email=email,
        passwordHash=hash_password(payload.password),
        role="user",
        status="active",
        creditBalance=FIRST_REGISTER_BONUS_CREDITS,
        createdAt=time.time(),
        lastLoginAt=time.time(),
        loginCount=1,
    )
    users[email] = user
    save_users(users)
    append_credit_transaction(create_credit_transaction(
        user,
        "bonus",
        FIRST_REGISTER_BONUS_CREDITS,
        user.creditBalance,
        "首次注册赠送积分",
    ))

    return AuthResponse(token=create_auth_token(email), user=user_to_public(user))

@app.post("/auth/login", response_model=AuthResponse)
def login_user(payload: AuthPayload):
    email = payload.email.strip().lower()
    users = load_users()
    user = users.get(email)

    if not user or not verify_password(payload.password, user.passwordHash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.status != "active":
        raise HTTPException(status_code=403, detail="User has been disabled")

    user.lastLoginAt = time.time()
    user.loginCount += 1
    users[email] = user
    save_users(users)

    return AuthResponse(token=create_auth_token(email), user=user_to_public(user))

@app.get("/auth/me", response_model=PublicUser)
def get_me(current_user: UserRecord = Depends(get_current_user)):
    return user_to_public(current_user)

@app.get("/billing/me", response_model=BillingOverview)
def get_billing_overview(current_user: UserRecord = Depends(get_current_user)):
    return billing.build_billing_overview(current_user, TRANSACTIONS_FILE)

@app.post("/billing/recharge", response_model=BillingOverview)
def create_recharge(payload: RechargePayload, current_user: UserRecord = Depends(get_current_user)):
    recharge_user_credits(current_user.email, payload.packageId)
    refreshed_user = load_users()[current_user.email.lower()]
    return billing.build_billing_overview(refreshed_user, TRANSACTIONS_FILE)

@app.get("/admin/users", response_model=List[PublicUser])
def get_users(_: UserRecord = Depends(require_admin)):
    users = load_users()
    return sorted(
        [user_to_public(user) for user in users.values()],
        key=lambda user: user.createdAt,
        reverse=True,
    )

@app.get("/admin/stats")
def get_admin_stats(_: UserRecord = Depends(require_admin)):
    users = list(load_users().values())
    transactions = load_credit_transactions()
    active_users = [user for user in users if user.status == "active"]
    recent_logins = [user for user in users if user.lastLoginAt and time.time() - user.lastLoginAt < 86400 * 7]
    active_agent_runs = [
        run for run in agent_runs.values()
        if run.status in {"queued", "planning", "awaiting_confirmation", "generating"}
    ]
    failed_agent_runs = [run for run in agent_runs.values() if run.status == "failed"]

    return {
        "totalUsers": len(users),
        "activeUsers": len(active_users),
        "recentLogins": len(recent_logins),
        "adminUsers": len([user for user in users if user.role == "admin"]),
        "generatedShots": len(shots_db),
        "queueSize": task_queue.qsize(),
        "agentRuns": len(agent_runs),
        "activeAgentRuns": len(active_agent_runs),
        "failedAgentRuns": len(failed_agent_runs),
        "userCreditBalance": sum(user.creditBalance for user in users),
        "rechargeRevenueCny": round(sum(
            transaction.priceCny or 0
            for transaction in transactions
            if transaction.type == "recharge"
        ), 2),
    }

@app.get("/admin/agent/config", response_model=AgentSettingsPublic)
def get_agent_config(_: UserRecord = Depends(require_admin)):
    return agent_settings_to_public(load_agent_settings())

@app.put("/admin/agent/config", response_model=AgentSettingsPublic)
def update_agent_config(payload: AgentSettingsUpdate, _: UserRecord = Depends(require_admin)):
    current = load_agent_settings()
    next_key = payload.deepseekApiKey.strip() if payload.deepseekApiKey else current.deepseekApiKey

    jimeng_mode = payload.jimengMode.strip().lower()
    if jimeng_mode not in {"cli", "mock"}:
        raise HTTPException(status_code=400, detail="即梦接入模式仅支持 cli 或 mock")
    jimeng_region = payload.jimengRegion.strip().lower()
    if jimeng_region not in {"cn", "us", "hk", "jp", "sg"}:
        raise HTTPException(status_code=400, detail="不支持的即梦区域")

    settings = AgentSettings(
        deepseekBaseUrl=payload.deepseekBaseUrl.rstrip("/") or "https://api.deepseek.com",
        deepseekModel=payload.deepseekModel.strip() or "deepseek-v4-flash",
        deepseekApiKey=next_key,
        jimengMode=jimeng_mode,
        jimengApiUrl=payload.jimengApiUrl,
        jimengModel=normalize_jimeng_model(payload.jimengModel),
        jimengRegion=jimeng_region,
        updatedAt=time.time(),
    )
    save_agent_settings(settings)
    return agent_settings_to_public(settings)

@app.get("/admin/agent/status")
def get_agent_status(_: UserRecord = Depends(require_admin)):
    settings = load_agent_settings()
    active_runs = [sync_run_from_shots(run) for run in agent_runs.values()]
    active_runs = sorted(active_runs, key=lambda item: item.updatedAt, reverse=True)
    return {
        "config": agent_settings_to_public(settings),
        "queueSize": task_queue.qsize(),
        "activeCookies": len([cookie for cookie in cookie_pool.values() if cookie.status == "active"]),
        "busyCookies": len([cookie for cookie in cookie_pool.values() if cookie.activeTasks > 0]),
        "runningRuns": len([
            run for run in active_runs
            if run.status in {"queued", "planning", "awaiting_confirmation", "generating"}
        ]),
        "failedRuns": len([run for run in active_runs if run.status == "failed"]),
        "recentRuns": active_runs[:8],
    }

@app.get("/admin/jimeng/account")
async def get_jimeng_account(_: UserRecord = Depends(require_admin), limit: int = 10):
    task_limit = max(1, min(limit, 30))
    return await get_account_snapshot(task_limit=task_limit)

@app.post("/agent/uploads", response_model=AgentUploadResponse)
async def upload_agent_reference(
    image: UploadFile = File(...),
    current_user: UserRecord = Depends(get_current_user),
):
    allowed_types = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
    extension = allowed_types.get(image.content_type or "")
    if not extension:
        raise HTTPException(status_code=400, detail="仅支持 JPG、PNG 或 WebP 参考图片")

    content = await image.read(10 * 1024 * 1024 + 1)
    await image.close()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="单张参考图片不能超过 10MB")
    if not content:
        raise HTTPException(status_code=400, detail="参考图片为空")

    image_id = f"ref-{secrets.token_hex(12)}"
    user_dir = UPLOADS_DIR / current_user.id
    user_dir.mkdir(parents=True, exist_ok=True)
    file_path = user_dir / f"{image_id}{extension}"
    file_path.write_bytes(content)
    reference = UploadedReference(
        id=image_id,
        userId=current_user.id,
        name=image.filename or f"reference{extension}",
        path=str(file_path),
    )
    uploaded_references[image_id] = reference
    return AgentUploadResponse(id=image_id, name=reference.name)

@app.post("/agent/runs", response_model=AgentRun)
async def create_agent_run(
    payload: AgentCreatePayload,
    background_tasks: BackgroundTasks,
    current_user: UserRecord = Depends(get_current_user),
):
    if not payload.idea.strip():
        raise HTTPException(status_code=400, detail="请先填写视频创意")
    invalid_references = [
        image_id for image_id in payload.imageIds
        if image_id not in uploaded_references
        or uploaded_references[image_id].userId != current_user.id
    ]
    if invalid_references:
        raise HTTPException(status_code=400, detail="存在无效或无权访问的参考图片")
    jimeng_model = normalize_jimeng_model(payload.jimengModel)
    estimated_credit_cost = calculate_video_credit_cost(jimeng_model, get_scene_durations(payload))

    run_id = f"agent-{int(time.time() * 1000)}-{secrets.token_hex(4)}"
    run = AgentRun(
        id=run_id,
        userId=current_user.id,
        userEmail=current_user.email,
        status="queued",
        stage="queued",
        progress=2,
        idea=payload.idea.strip(),
        duration=payload.duration,
        segmentDuration=payload.segmentDuration,
        style=payload.style,
        ratio=payload.ratio,
        jimengModel=jimeng_model,
        estimatedCreditCost=estimated_credit_cost,
        imageNames=payload.imageNames,
        imageIds=payload.imageIds,
        createdAt=time.time(),
        updatedAt=time.time(),
    )
    agent_runs[run_id] = run
    background_tasks.add_task(process_agent_run, run_id)
    return run

@app.post("/agent/runs/{run_id}/confirm", response_model=AgentRun)
async def confirm_agent_run(
    run_id: str,
    payload: AgentConfirmPayload,
    background_tasks: BackgroundTasks,
    current_user: UserRecord = Depends(get_current_user),
):
    run = agent_runs.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Agent run not found")
    if current_user.role != "admin" and run.userId != current_user.id:
        raise HTTPException(status_code=403, detail="You cannot edit this Agent run")
    if run.status != "awaiting_confirmation":
        raise HTTPException(status_code=409, detail="当前任务不在分镜确认阶段")
    if payload.candidateId not in {candidate.id for candidate in run.candidates}:
        raise HTTPException(status_code=400, detail="候选剧本不存在")
    if sum(scene.duration for scene in payload.scenes) != run.duration:
        raise HTTPException(status_code=400, detail="分镜总时长必须与目标视频时长一致")

    start = 0
    confirmed_scenes = []
    for index, scene in enumerate(payload.scenes):
        end = start + scene.duration
        confirmed_scenes.append(
            AgentRunScene(
                id=f"{run.id}-scene-{index + 1}",
                number=str(index + 1).zfill(2),
                time=f"{format_time(start)} - {format_time(end)}",
                title=scene.title.strip(),
                prompt=scene.prompt.strip(),
                duration=scene.duration,
            )
        )
        start = end

    credit_cost = calculate_video_credit_cost(run.jimengModel, [scene.duration for scene in payload.scenes])
    charge_user_credits(
        run.userEmail,
        credit_cost,
        f"视频生成扣费：{run.duration} 秒 / {len(confirmed_scenes)} 段 / {run.jimengModel}",
        run_id=run.id,
    )

    run.selectedCandidateId = payload.candidateId
    run.scenes = confirmed_scenes
    run.estimatedCreditCost = credit_cost
    run.creditCost = credit_cost
    run.creditChargedAt = time.time()
    run.status = "queued"
    run.stage = "jimeng_dispatch"
    run.progress = 20
    run.updatedAt = time.time()
    agent_runs[run.id] = run
    background_tasks.add_task(process_confirmed_run, run.id)
    return run

@app.get("/agent/runs/{run_id}", response_model=AgentRun)
def get_agent_run(run_id: str, current_user: UserRecord = Depends(get_current_user)):
    run = agent_runs.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Agent run not found")
    if current_user.role != "admin" and run.userId != current_user.id:
        raise HTTPException(status_code=403, detail="You cannot view this Agent run")
    return sync_run_from_shots(run)

@app.get("/health")
def health_check():
    """Return hardware status and backend health information."""
    return {
        "status": "healthy",
        "cpu_usage_pct": round(random.uniform(5.0, 15.0), 1),
        "vram_allocated_gb": 0.0,
        "concurrency_limit": 2,
        "queue_size": task_queue.qsize(),
        "timestamp": time.time(),
        "jimeng_cli": cli_public_status(),
    }

# --- Cookie Pool CRUD ---

@app.get("/cookies", response_model=List[Cookie])
def get_all_cookies():
    return list(cookie_pool.values())

@app.post("/cookies", response_model=Cookie)
def add_cookie(cookie: Cookie):
    if cookie.id in cookie_pool:
        raise HTTPException(status_code=400, detail="Cookie ID already exists")
    cookie_pool[cookie.id] = cookie
    return cookie

@app.put("/cookies/{cookie_id}", response_model=Cookie)
def update_cookie(cookie_id: str, updates: Cookie):
    if cookie_id not in cookie_pool:
        raise HTTPException(status_code=404, detail="Cookie not found")
    cookie_pool[cookie_id] = updates
    return updates

@app.delete("/cookies/{cookie_id}")
def delete_cookie(cookie_id: str):
    if cookie_id not in cookie_pool:
        raise HTTPException(status_code=404, detail="Cookie not found")
    del cookie_pool[cookie_id]
    return {"message": f"Cookie {cookie_id} successfully deleted"}

@app.post("/cookies/{cookie_id}/validate")
async def validate_cookie(cookie_id: str):
    if cookie_id not in cookie_pool:
        raise HTTPException(status_code=404, detail="Cookie not found")
    
    # Simulate validation latency
    await asyncio.sleep(1.0)
    c = cookie_pool[cookie_id]
    c.status = "active"
    c.failCount = 0
    return {"status": "success", "message": f"Cookie {c.alias} verified successfully."}

# --- Storyboard & Task Dispatch ---

@app.get("/shots", response_model=List[Shot])
def get_all_shots():
    return list(shots_db.values())

@app.post("/shots", response_model=Shot)
def upsert_shot(shot: Shot):
    shots_db[shot.id] = shot
    return shot

@app.post("/generate/{shot_id}")
async def queue_generation(shot_id: str, shot_payload: Optional[Shot] = None):
    """Adds a shot to the asynchronous video generation queue."""
    if shot_payload:
        shots_db[shot_id] = shot_payload
    elif shot_id not in shots_db:
        raise HTTPException(status_code=404, detail="Shot not found in database")

    shot = shots_db[shot_id]
    shot.status = "waiting"
    shot.progress = 0
    shot.error = None
    
    await task_queue.put(shot_id)
    return {"status": "queued", "shot_id": shot_id, "queue_position": task_queue.qsize()}

@app.post("/compile")
async def compile_final_video(params: CompileParams):
    """
    Mock endpoint representing the final ffmpeg mixing process.
    Mixes BGM audio, voice-overs, and stacks the completed video clips.
    """
    logger.info(f"Starting compile task for shots {params.shotIds}")
    
    # Verify all referenced shots exist and are completed
    completed_videos = []
    for s_id in params.shotIds:
        shot = shots_db.get(s_id)
        if shot and shot.status == "completed" and shot.videoUrl:
            completed_videos.append(shot.videoUrl)
            
    if not completed_videos:
        raise HTTPException(
            status_code=400, 
            detail="Must have at least one successfully generated shot to compile."
        )

    # Return the first clip as the compiled result, simulating a successful edit
    result_url = completed_videos[0]
    
    return {
        "status": "success",
        "video_url": result_url,
        "bgm": params.bgm,
        "total_duration": params.totalDuration,
        "message": f"Compilation successful with BGM: {params.bgm}"
    }

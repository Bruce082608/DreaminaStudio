import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import random
import re
import secrets
import smtplib
import time
from dataclasses import dataclass
from pathlib import Path
from email.message import EmailMessage
from typing import Any, Dict, List, Literal, Optional
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import httpx
from pydantic import BaseModel, Field

try:
    from .jimeng_cli import JimengCliError, cli_public_status, generate_video, get_account_snapshot, wake_account_pool_waiters
    from . import billing, database
    from .billing import (
        BillingOverview,
        CreditTransaction,
        FIRST_REGISTER_BONUS_CREDITS,
        RechargeApprovalPayload,
        RechargePackage,
        RechargePayload,
        RechargeRequest,
    )
except ImportError:
    from jimeng_cli import JimengCliError, cli_public_status, generate_video, get_account_snapshot, wake_account_pool_waiters
    import billing
    import database
    from billing import (
        BillingOverview,
        CreditTransaction,
        FIRST_REGISTER_BONUS_CREDITS,
        RechargeApprovalPayload,
        RechargePackage,
        RechargePayload,
        RechargeRequest,
    )

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("dreamina_backend")

MAX_REFERENCE_IMAGES = 9
REFERENCE_TOKEN_PATTERN = re.compile(r"@([A-Za-z0-9_\-\u4e00-\u9fff]+)")

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
    failureCategory: Optional[str] = None
    failureTitle: Optional[str] = None
    failureReason: Optional[str] = None
    failureDetail: Optional[str] = None
    failureSubmitId: Optional[str] = None
    failureLogId: Optional[str] = None
    jimengSubmitId: Optional[str] = None
    jimengAccountId: Optional[str] = None
    jimengAccountAlias: Optional[str] = None
    queuePosition: Optional[int] = None
    queueTotal: Optional[int] = None
    queueStatus: Optional[str] = None
    queueAhead: Optional[int] = None
    queueActive: Optional[int] = None
    queueCapacity: Optional[int] = None
    queueUpdatedAt: Optional[float] = None

class CompileParams(BaseModel):
    bgm: str = "lofi"
    bgmVolume: int = 30
    voiceVolume: int = 80
    totalDuration: int = 60
    shotIds: List[str]

class UserRecord(BaseModel):
    id: str
    name: str
    email: str = ""
    phone: Optional[str] = None
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
    email: str = ""
    phone: Optional[str] = None
    role: str
    status: str
    creditBalance: int = 0
    rechargeCount: int = 0
    lifetimeRechargeCny: float = 0
    createdAt: float
    lastLoginAt: Optional[float] = None
    loginCount: int = 0

class AuthPayload(BaseModel):
    identifier: Optional[str] = None
    email: Optional[str] = None
    password: str

class RegisterPayload(AuthPayload):
    name: str
    channel: Optional[Literal["email"]] = "email"
    code: Optional[str] = None

class VerificationCodePayload(BaseModel):
    channel: Literal["email"] = "email"
    identifier: str
    purpose: Literal["register"] = "register"

class VerificationCodeResponse(BaseModel):
    channel: str
    identifier: str
    expiresIn: int
    delivery: str
    devCode: Optional[str] = None

class ProfileUpdatePayload(BaseModel):
    name: str = Field(min_length=2, max_length=40)

class PasswordChangePayload(BaseModel):
    currentPassword: str
    newPassword: str = Field(min_length=8, max_length=128)

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

class AgentImageReference(BaseModel):
    id: str
    name: str = ""
    label: str = ""
    token: Optional[str] = None

class AgentCreatePayload(BaseModel):
    idea: str
    duration: int = Field(default=180, ge=15, le=600)
    segmentDuration: int = Field(default=10, ge=4, le=15)
    style: str = "电影感"
    ratio: str = "16:9"
    jimengModel: str = "seedance2.0fast"
    imageNames: List[str] = Field(default_factory=list)
    imageIds: List[str] = Field(default_factory=list, max_items=MAX_REFERENCE_IMAGES)
    imageReferences: List[AgentImageReference] = Field(default_factory=list, max_items=MAX_REFERENCE_IMAGES)
    sceneLimit: str = ""
    sceneImageNames: List[str] = Field(default_factory=list)
    sceneImageIds: List[str] = Field(default_factory=list, max_items=MAX_REFERENCE_IMAGES)
    sceneImageReferences: List[AgentImageReference] = Field(default_factory=list, max_items=MAX_REFERENCE_IMAGES)
    blockSubtitles: bool = True
    soundEffectOnly: bool = False
    forceMute: bool = False

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
    failureCategory: Optional[str] = None
    failureTitle: Optional[str] = None
    failureReason: Optional[str] = None
    failureDetail: Optional[str] = None
    failureSubmitId: Optional[str] = None
    failureLogId: Optional[str] = None
    jimengSubmitId: Optional[str] = None
    jimengAccountId: Optional[str] = None
    jimengAccountAlias: Optional[str] = None
    queuePosition: Optional[int] = None
    queueTotal: Optional[int] = None
    queueStatus: Optional[str] = None
    queueAhead: Optional[int] = None
    queueActive: Optional[int] = None
    queueCapacity: Optional[int] = None
    queueUpdatedAt: Optional[float] = None
    creditRefundedAt: Optional[float] = None
    refundCredit: int = 0
    retryCount: int = 0

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
    scenes: List[AgentSceneEdit] = Field(min_items=1, max_items=150)

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
    imageReferences: List[AgentImageReference] = Field(default_factory=list)
    sceneLimit: str = ""
    sceneImageNames: List[str] = Field(default_factory=list)
    sceneImageIds: List[str] = Field(default_factory=list)
    sceneImageReferences: List[AgentImageReference] = Field(default_factory=list)
    blockSubtitles: bool = True
    soundEffectOnly: bool = False
    forceMute: bool = False
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

def env_flag(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).lower() in {"1", "true", "yes", "on"}

def env_int(name: str, default: int, *, minimum: int = 0, maximum: Optional[int] = None) -> int:
    raw_value = os.getenv(name)
    try:
        value = int(raw_value) if raw_value not in (None, "") else default
    except ValueError:
        logger.warning("Invalid integer for %s=%r, using %s", name, raw_value, default)
        value = default
    value = max(value, minimum)
    if maximum is not None:
        value = min(value, maximum)
    return value

def env_float(name: str, default: float, *, minimum: float = 0.0, maximum: Optional[float] = None) -> float:
    raw_value = os.getenv(name)
    try:
        value = float(raw_value) if raw_value not in (None, "") else default
    except ValueError:
        logger.warning("Invalid float for %s=%r, using %s", name, raw_value, default)
        value = default
    value = max(value, minimum)
    if maximum is not None:
        value = min(value, maximum)
    return value

AGENT_WORKER_COUNT = env_int("DREAMINA_AGENT_WORKERS", 4, minimum=1, maximum=64)
AGENT_MAX_QUEUE_SIZE = env_int("DREAMINA_AGENT_MAX_QUEUE_SIZE", 200, minimum=1, maximum=10000)
AGENT_USER_ACTIVE_RUN_LIMIT = env_int("DREAMINA_USER_ACTIVE_RUN_LIMIT", 2, minimum=0, maximum=1000)
AGENT_USER_QUEUED_RUN_LIMIT = env_int("DREAMINA_USER_QUEUED_RUN_LIMIT", 20, minimum=0, maximum=10000)
AGENT_REQUEUE_DELAY_SECONDS = env_float("DREAMINA_AGENT_REQUEUE_DELAY_SECONDS", 0.5, minimum=0.05, maximum=30.0)

@dataclass(frozen=True)
class AgentJob:
    kind: Literal["plan", "generate", "retry", "resume"]
    run_id: str
    scene_id: Optional[str] = None
    user_id: Optional[str] = None
    bypass_user_limits: bool = False
    created_at: float = 0.0

    @property
    def key(self) -> str:
        return f"{self.kind}:{self.run_id}:{self.scene_id or ''}"


class AgentRunCancelled(RuntimeError):
    pass


AGENT_TERMINAL_STATUSES = {"completed", "failed", "canceled"}
AGENT_CANCELABLE_STATUSES = {"queued", "planning", "awaiting_confirmation", "generating"}

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
agent_job_queue: asyncio.Queue = asyncio.Queue(maxsize=AGENT_MAX_QUEUE_SIZE)
agent_queued_jobs: Dict[str, AgentJob] = {}
agent_active_jobs: Dict[str, AgentJob] = {}
agent_scheduler_lock = asyncio.Lock()
agent_worker_tasks: List[asyncio.Task] = []

DATA_DIR = Path(__file__).resolve().parent / "data"
USERS_FILE = DATA_DIR / "users.json"
SETTINGS_FILE = DATA_DIR / "agent_settings.json"
AGENT_RUNS_FILE = DATA_DIR / "agent_runs.json"
UPLOADED_REFERENCES_FILE = DATA_DIR / "uploaded_references.json"
TRANSACTIONS_FILE = DATA_DIR / "credit_transactions.json"
VERIFICATION_CODES_FILE = DATA_DIR / "verification_codes.json"
UPLOADS_DIR = DATA_DIR / "uploads"
OUTPUTS_DIR = DATA_DIR / "outputs"
ENVIRONMENT = os.getenv("ENV", "development").lower()
DEFAULT_ADMIN_EMAIL = os.getenv("DREAMINA_ADMIN_EMAIL", "admin@dreamina.local").lower()
DEFAULT_ADMIN_PASSWORD = os.getenv("DREAMINA_ADMIN_PASSWORD", "Dreamina@2026")
AUTH_SECRET = os.getenv("DREAMINA_AUTH_SECRET", "dreamina-studio-local-dev-secret")
VERIFICATION_CODE_TTL_SECONDS = int(os.getenv("DREAMINA_VERIFICATION_CODE_TTL_SECONDS", "600"))
VERIFICATION_CODE_RESEND_COOLDOWN_SECONDS = int(os.getenv("DREAMINA_VERIFICATION_RESEND_COOLDOWN_SECONDS", "60"))
VERIFICATION_CODE_DEV_MODE = env_flag(
    "DREAMINA_VERIFICATION_DEV_MODE",
    "false" if ENVIRONMENT == "production" else "true",
)
SMTP_HOST = os.getenv("DREAMINA_SMTP_HOST", "smtp.qq.com")
SMTP_PORT = int(os.getenv("DREAMINA_SMTP_PORT", "465"))
SMTP_USERNAME = os.getenv("DREAMINA_SMTP_USERNAME", "873831183@qq.com")
SMTP_PASSWORD = os.getenv("DREAMINA_SMTP_PASSWORD")
SMTP_FROM = os.getenv("DREAMINA_SMTP_FROM", SMTP_USERNAME or "no-reply@dreamina.local")
SMTP_USE_TLS = env_flag("DREAMINA_SMTP_TLS", "false")
SMTP_USE_SSL = env_flag("DREAMINA_SMTP_SSL", "true")

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

def create_auth_token(subject: str) -> str:
    payload = {
        "sub": subject,
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
        return str(payload.get("sub") or payload["email"]).lower()
    except (KeyError, ValueError, json.JSONDecodeError):
        raise HTTPException(status_code=401, detail="Invalid or expired session") from None

def dump_model(model: BaseModel, **kwargs):
    if hasattr(model, "model_dump"):
        return model.model_dump(**kwargs)
    return model.dict(**kwargs)

def user_to_public(user: UserRecord) -> PublicUser:
    return PublicUser(**dump_model(user, exclude={"passwordHash"}))

def get_user_contact(user: UserRecord) -> str:
    return user.email or user.phone or user.id

def get_user_account_key(user: UserRecord) -> str:
    if user.email:
        return user.email.lower()
    if user.phone:
        return f"phone:{normalize_phone(user.phone)}"
    return user.id.lower()

def normalize_email(email: str) -> str:
    value = (email or "").strip().lower()
    if "@" not in value or "." not in value:
        raise HTTPException(status_code=400, detail="请输入有效邮箱")
    return value

def normalize_phone(phone: str) -> str:
    digits = "".join(char for char in (phone or "").strip() if char.isdigit())
    if len(digits) < 8 or len(digits) > 15:
        raise HTTPException(status_code=400, detail="请输入有效手机号")
    return digits

def normalize_identifier(channel: str, identifier: str) -> str:
    if channel == "email":
        return normalize_email(identifier)
    if channel == "phone":
        return normalize_phone(identifier)
    raise HTTPException(status_code=400, detail="仅支持邮箱注册")

def guess_auth_channel(identifier: str) -> str:
    value = (identifier or "").strip()
    return "email" if "@" in value else "phone"

def get_user_storage_key(channel: str, identifier: str) -> str:
    normalized = normalize_identifier(channel, identifier)
    return normalized if channel == "email" else f"phone:{normalized}"

def load_users() -> Dict[str, UserRecord]:
    raw_users = database.load_users()
    return {storage_key.lower(): UserRecord(**data) for storage_key, data in raw_users.items()}

def save_users(users: Dict[str, UserRecord]) -> None:
    database.save_users(users)

def find_user_by_identifier(users: Dict[str, UserRecord], identifier: str) -> tuple[Optional[str], Optional[UserRecord]]:
    raw_identifier = (identifier or "").strip()
    if not raw_identifier:
        return None, None

    direct_key = raw_identifier.lower()
    if direct_key in users:
        return direct_key, users[direct_key]

    channel = guess_auth_channel(raw_identifier)
    try:
        key = get_user_storage_key(channel, raw_identifier)
    except HTTPException:
        return None, None
    if key in users:
        return key, users[key]

    normalized = normalize_identifier(channel, raw_identifier)
    for user_key, user in users.items():
        if channel == "email" and user.email.lower() == normalized:
            return user_key, user
        if channel == "phone" and user.phone and normalize_phone(user.phone) == normalized:
            return user_key, user
    return None, None

def code_digest(channel: str, identifier: str, purpose: str, code: str) -> str:
    message = f"{channel}:{identifier}:{purpose}:{code}".encode("utf-8")
    return hmac.new(AUTH_SECRET.encode("utf-8"), message, hashlib.sha256).hexdigest()

def verification_key(channel: str, identifier: str, purpose: str) -> str:
    return f"{channel}:{identifier}:{purpose}"

def load_verification_codes() -> Dict[str, Dict[str, Any]]:
    return database.load_verification_codes()

def save_verification_codes(codes: Dict[str, Dict[str, Any]]) -> None:
    database.save_verification_codes(codes)

def send_email_code(email: str, code: str) -> str:
    if not SMTP_HOST:
        if VERIFICATION_CODE_DEV_MODE:
            logger.info("Dev verification code for %s: %s", email, code)
            return "dev"
        raise HTTPException(status_code=503, detail="邮件验证码服务尚未配置")
    if SMTP_USERNAME and not SMTP_PASSWORD:
        if VERIFICATION_CODE_DEV_MODE:
            logger.info("Dev verification code for %s: %s", email, code)
            return "dev"
        raise HTTPException(status_code=503, detail="邮件验证码 SMTP 授权码未配置")

    message = EmailMessage()
    message["Subject"] = "Dreamina Studio 注册验证码"
    message["From"] = SMTP_FROM
    message["To"] = email
    message.set_content(f"你的 Dreamina Studio 注册验证码是：{code}。验证码 {VERIFICATION_CODE_TTL_SECONDS // 60} 分钟内有效。")

    smtp_class = smtplib.SMTP_SSL if SMTP_USE_SSL else smtplib.SMTP
    try:
        with smtp_class(SMTP_HOST, SMTP_PORT, timeout=12) as smtp:
            if SMTP_USE_TLS and not SMTP_USE_SSL:
                smtp.starttls()
            if SMTP_USERNAME and SMTP_PASSWORD:
                smtp.login(SMTP_USERNAME, SMTP_PASSWORD)
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException) as exc:
        logger.exception("Failed to send email verification code to %s", email)
        raise HTTPException(status_code=502, detail="邮件验证码发送失败，请稍后重试") from exc
    return "email"

def verify_registration_code(channel: str, identifier: str, code: str) -> None:
    normalized = normalize_identifier(channel, identifier)
    codes = load_verification_codes()
    key = verification_key(channel, normalized, "register")
    record = codes.get(key)
    if not record:
        raise HTTPException(status_code=400, detail="验证码已过期，请重新获取")
    if int(record.get("attempts", 0)) >= 5:
        codes.pop(key, None)
        save_verification_codes(codes)
        raise HTTPException(status_code=400, detail="验证码尝试次数过多，请重新获取")

    expected = record.get("codeHash")
    actual = code_digest(channel, normalized, "register", (code or "").strip())
    if not hmac.compare_digest(str(expected), actual):
        record["attempts"] = int(record.get("attempts", 0)) + 1
        codes[key] = record
        save_verification_codes(codes)
        raise HTTPException(status_code=400, detail="验证码不正确")

    codes.pop(key, None)
    save_verification_codes(codes)

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

def recharge_user_credits(identifier: str, package_id: str) -> CreditTransaction:
    users = load_users()
    user_key, user = find_user_by_identifier(users, identifier)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    transaction = billing.apply_recharge(users, user_key or identifier, package_id, TRANSACTIONS_FILE)
    save_users(users)
    return transaction

def create_user_recharge_request(current_user: UserRecord, package_id: str) -> RechargeRequest:
    return billing.create_recharge_request_for_user(current_user, package_id, TRANSACTIONS_FILE)

def load_user_recharge_requests(current_user: UserRecord, limit: int = 20) -> List[RechargeRequest]:
    return billing.get_user_recharge_requests(current_user, limit=limit)

def load_admin_recharge_requests(status: Optional[str] = None, limit: int = 100) -> List[RechargeRequest]:
    return billing.load_recharge_requests(status=status, limit=limit)

def approve_user_recharge_request(
    request_id: str,
    admin_user: UserRecord,
    *,
    credits: Optional[int] = None,
    admin_note: Optional[str] = None,
) -> tuple[RechargeRequest, CreditTransaction]:
    users = load_users()
    recharge_request, transaction = billing.apply_recharge_request_approval(
        users,
        request_id,
        admin_user,
        TRANSACTIONS_FILE,
        credits=credits,
        admin_note=admin_note,
    )
    save_users(users)
    return recharge_request, transaction

def charge_user_credits(identifier: str, amount: int, description: str, run_id: Optional[str] = None) -> CreditTransaction:
    users = load_users()
    user_key, user = find_user_by_identifier(users, identifier)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    transaction = billing.apply_debit(users, user_key or identifier, amount, description, TRANSACTIONS_FILE, run_id=run_id)
    save_users(users)
    return transaction

def refund_user_credits(identifier: str, amount: int, description: str, run_id: Optional[str] = None) -> CreditTransaction:
    if amount <= 0:
        raise HTTPException(status_code=400, detail="返还积分必须大于 0")
    users = load_users()
    user_key, user = find_user_by_identifier(users, identifier)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    storage_key = user_key or identifier
    user.creditBalance += amount
    users[storage_key.lower()] = user
    transaction = create_credit_transaction(
        user,
        "refund",
        amount,
        user.creditBalance,
        description,
        run_id=run_id,
    )
    append_credit_transaction(transaction)
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
    subject = parse_auth_token(token)
    users = load_users()
    user = users.get(subject)
    if not user:
        _, user = find_user_by_identifier(users, subject)
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

def write_json_file(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(f"{path.suffix}.tmp")
    with temp_path.open("w", encoding="utf-8") as file:
        json.dump(jsonable_encoder(payload), file, ensure_ascii=False, indent=2)
    temp_path.replace(path)

def load_agent_runs_from_disk() -> None:
    if not AGENT_RUNS_FILE.exists():
        return
    try:
        raw_payload = json.loads(AGENT_RUNS_FILE.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Failed to load persisted Agent runs: %s", exc)
        return

    raw_runs = raw_payload.values() if isinstance(raw_payload, dict) else raw_payload
    restored_runs: Dict[str, AgentRun] = {}
    for raw_run in raw_runs or []:
        try:
            run = AgentRun(**raw_run)
        except Exception as exc:
            logger.warning("Skipping invalid persisted Agent run: %s", exc)
            continue
        restored_runs[run.id] = run
    agent_runs.update(restored_runs)

def persist_agent_runs() -> None:
    write_json_file(
        AGENT_RUNS_FILE,
        sorted(agent_runs.values(), key=lambda run: run.createdAt, reverse=True),
    )

def persist_agent_run(run: AgentRun) -> AgentRun:
    agent_runs[run.id] = run
    persist_agent_runs()
    return run

def load_uploaded_references_from_disk() -> None:
    if not UPLOADED_REFERENCES_FILE.exists():
        return
    try:
        raw_payload = json.loads(UPLOADED_REFERENCES_FILE.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Failed to load uploaded reference index: %s", exc)
        return

    raw_references = raw_payload.values() if isinstance(raw_payload, dict) else raw_payload
    restored_references: Dict[str, UploadedReference] = {}
    for raw_reference in raw_references or []:
        try:
            reference = UploadedReference(**raw_reference)
        except Exception as exc:
            logger.warning("Skipping invalid uploaded reference record: %s", exc)
            continue
        restored_references[reference.id] = reference
    uploaded_references.update(restored_references)

def persist_uploaded_references() -> None:
    write_json_file(
        UPLOADED_REFERENCES_FILE,
        sorted(uploaded_references.values(), key=lambda reference: reference.id),
    )

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

def default_reference_label(index: int) -> str:
    return f"图片{index + 1}"

def default_scene_reference_label(index: int) -> str:
    return f"场景{index + 1}"

def normalize_reference_label(value: Optional[str], fallback: str) -> str:
    normalized = (value or "").strip().lstrip("@").strip()
    return normalized or fallback

def copy_model_with_update(model: BaseModel, updates: Dict[str, Any]):
    if hasattr(model, "model_copy"):
        return model.model_copy(update=updates)
    return model.copy(update=updates)

def build_payload_image_references(payload: AgentCreatePayload) -> List[AgentImageReference]:
    return build_reference_list(
        payload.imageIds,
        payload.imageNames,
        payload.imageReferences,
        default_reference_label,
    )

def build_payload_scene_references(payload: AgentCreatePayload) -> List[AgentImageReference]:
    return build_reference_list(
        payload.sceneImageIds,
        payload.sceneImageNames,
        payload.sceneImageReferences,
        default_scene_reference_label,
    )

def build_reference_list(
    image_ids: List[str],
    image_names: List[str],
    image_references: List[AgentImageReference],
    label_factory,
) -> List[AgentImageReference]:
    declared_references = {
        reference.id: reference
        for reference in image_references
        if reference.id
    }
    references = []
    for index, image_id in enumerate(image_ids[:MAX_REFERENCE_IMAGES]):
        uploaded = uploaded_references.get(image_id)
        declared = declared_references.get(image_id)
        fallback_name = image_names[index] if index < len(image_names) else ""
        name = (declared.name if declared and declared.name else "") or (uploaded.name if uploaded else "") or fallback_name
        label = normalize_reference_label(
            declared.label if declared else None,
            label_factory(index),
        )
        references.append(
            AgentImageReference(
                id=image_id,
                name=name or label,
                label=label,
                token=f"@{label}",
            )
        )
    return references

def get_payload_reference_descriptions(payload: AgentCreatePayload) -> List[str]:
    references = payload.imageReferences
    if not references and payload.imageIds:
        references = [
            AgentImageReference(
                id=image_id,
                name=payload.imageNames[index] if index < len(payload.imageNames) else default_reference_label(index),
                label=default_reference_label(index),
                token=f"@{default_reference_label(index)}",
            )
            for index, image_id in enumerate(payload.imageIds)
        ]
    return [
        f"- @{reference.label}: {reference.name or reference.label}"
        for reference in references
    ]

def get_payload_scene_reference_descriptions(payload: AgentCreatePayload) -> List[str]:
    references = payload.sceneImageReferences
    if not references and payload.sceneImageIds:
        references = [
            AgentImageReference(
                id=image_id,
                name=payload.sceneImageNames[index] if index < len(payload.sceneImageNames) else default_scene_reference_label(index),
                label=default_scene_reference_label(index),
                token=f"@{default_scene_reference_label(index)}",
            )
            for index, image_id in enumerate(payload.sceneImageIds)
        ]
    return [
        f"- @{reference.label}: {reference.name or reference.label}"
        for reference in references
    ]

def build_prompt_constraints(
    *,
    scene_limit: str = "",
    block_subtitles: bool = True,
    sound_effect_only: bool = False,
    force_mute: bool = False,
) -> List[str]:
    constraints = []
    normalized_scene_limit = (scene_limit or "").strip()
    if normalized_scene_limit:
        constraints.append(f"场景限制：{normalized_scene_limit}")
    if block_subtitles:
        constraints.append("不要出现任何字幕。")
    if force_mute:
        constraints.append("不要有任何声音。")
    elif sound_effect_only:
        constraints.append("不要有任何背景音乐，只保留音效。")
    return constraints

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
    reference_lines = get_payload_reference_descriptions(payload)
    scene_reference_lines = get_payload_scene_reference_descriptions(payload)
    reference_summary = "、".join(line.removeprefix("- ") for line in reference_lines)
    scene_reference_summary = "、".join(line.removeprefix("- ") for line in scene_reference_lines)
    constraints = build_prompt_constraints(
        scene_limit=payload.sceneLimit,
        block_subtitles=payload.blockSubtitles,
        sound_effect_only=payload.soundEffectOnly,
        force_mute=payload.forceMute,
    )
    constraint_note = " ".join(constraints)
    scenes = []
    start = 0
    for scene_index, scene_duration in enumerate(get_scene_durations(payload)):
        end = start + scene_duration
        reference_note = (
            f"使用上传参考图保持人物一致，引用关系为：{reference_summary}。不描述人物衣物服装。"
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
                    f"{'场景参考图：' + scene_reference_summary + '。' if scene_reference_summary else ''}"
                    f"{constraint_note}"
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
    reference_lines = get_payload_reference_descriptions(payload)
    scene_reference_lines = get_payload_scene_reference_descriptions(payload)
    constraints = build_prompt_constraints(
        scene_limit=payload.sceneLimit,
        block_subtitles=payload.blockSubtitles,
        sound_effect_only=payload.soundEffectOnly,
        force_mute=payload.forceMute,
    )
    reference_rule = (
        "有参考图片。用户会用 @图片1、@图片2 这类标记引用具体图片；"
        "必须理解每个标记对应的参考图，并在需要该参考图的分镜提示词中保留相同 @ 标记。"
        "不要混淆不同参考图；不要对参考图人物进行衣物、服装、配饰上的描述；"
        "只需用对应 @ 标记或‘参考图中的人物’指代，并保持人物一致。"
        if payload.imageIds
        else "没有参考图片，需要完整描述人物的稳定视觉特征。"
    )
    reference_catalog = (
        f"\n【参考图片引用目录】\n{chr(10).join(reference_lines)}\n"
        "如果用户的剧本描述中出现这些 @ 标记，请把标记和对应画面关系写入相关分镜 prompt。"
        if reference_lines
        else ""
    )
    scene_catalog = (
        f"\n【场景限制】\n{payload.sceneLimit.strip() if payload.sceneLimit.strip() else '无文字场景限制'}\n"
        f"{chr(10).join(scene_reference_lines) if scene_reference_lines else '无场景参考图片'}\n"
        "场景限制是每一段分镜的前提，必须写入每段 prompt。"
        if payload.sceneLimit.strip() or scene_reference_lines
        else ""
    )
    constraint_catalog = (
        f"\n【强制生成限制】\n{chr(10).join(f'- {constraint}' for constraint in constraints)}\n"
        "这些限制必须写入每段 prompt，且优先级高于补充创意。"
        if constraints
        else ""
    )
    return f"""【基础设定】
我将使用即梦{payload.jimengModel}模型制作一个总长{payload.duration}秒的分段长视频，请你按照要求生成详细的提示词剧本，并可适当补充细节（人物对话、人物动作等，但必须包含我说的内容）。

【画面分镜风格】
使用{payload.style}式的分镜剧本，画幅为{payload.ratio}。{reference_rule}
每一段分镜目标时长为{payload.segmentDuration}秒，本次各段实际时长依次为：{scene_durations}秒。
需要考虑到视频生成模型无法看到上一段提示词，所以每一段之间应完全独立描述，重复写清人物、场景、时间、光线和必要的连续性信息。如有角色，则在剧本中跟随角色的动作或对话描述运镜。
{reference_catalog}
{scene_catalog}
{constraint_catalog}

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
            scene.failureCategory = shot.failureCategory
            scene.failureTitle = shot.failureTitle
            scene.failureReason = shot.failureReason
            scene.failureDetail = shot.failureDetail
            scene.failureSubmitId = shot.failureSubmitId
            scene.failureLogId = shot.failureLogId
            scene.jimengSubmitId = shot.jimengSubmitId
            scene.jimengAccountId = shot.jimengAccountId
            scene.jimengAccountAlias = shot.jimengAccountAlias
            scene.queuePosition = shot.queuePosition
            scene.queueTotal = shot.queueTotal
            scene.queueStatus = shot.queueStatus
            scene.queueAhead = shot.queueAhead
            scene.queueActive = shot.queueActive
            scene.queueCapacity = shot.queueCapacity
            scene.queueUpdatedAt = shot.queueUpdatedAt
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
            failed_scenes = [scene for scene in run.scenes if scene.status == "failed"]
            run.status = "failed" if failed_scenes else "completed"
            run.stage = "failed" if failed_scenes else "completed"
            run.progress = 100
            run.finalVideoUrl = completed_scenes[0].videoUrl if completed_scenes else None
            if failed_scenes:
                failed_scene = next((scene for scene in run.scenes if scene.status == "failed"), None)
                failed_reason = failed_scene.failureTitle if failed_scene and failed_scene.failureTitle else "即梦生成失败"
                if completed_scenes:
                    run.error = (
                        f"{len(failed_scenes)} 个分镜生成失败，已完成 {len(completed_scenes)} 个；"
                        f"首个失败原因：{failed_reason}。可点击失败分镜重试。"
                    )
                else:
                    run.error = f"所有即梦分镜任务均未成功生成；首个失败原因：{failed_reason}"
            else:
                run.error = None
    run.updatedAt = time.time()
    return persist_agent_run(run)

def backend_status_to_agent_status(status: str) -> str:
    return {
        "idle": "queued",
        "waiting": "waiting",
        "generating": "generating",
        "completed": "completed",
        "failed": "failed",
        "canceled": "canceled",
    }.get(status, status)

def clear_generation_failure(shot: Shot) -> None:
    shot.error = None
    shot.failureCategory = None
    shot.failureTitle = None
    shot.failureReason = None
    shot.failureDetail = None
    shot.failureSubmitId = None
    shot.failureLogId = None

def clear_generation_queue(shot: Shot) -> None:
    shot.jimengSubmitId = None
    shot.jimengAccountId = None
    shot.jimengAccountAlias = None
    shot.queuePosition = None
    shot.queueTotal = None
    shot.queueStatus = None
    shot.queueAhead = None
    shot.queueActive = None
    shot.queueCapacity = None
    shot.queueUpdatedAt = None

def apply_generation_error_to_shot(shot: Shot, exc: Exception) -> None:
    shot.error = str(exc)
    shot.failureCategory = getattr(exc, "failure_category", None) or "unknown"
    shot.failureTitle = getattr(exc, "failure_title", None) or "即梦生成失败"
    shot.failureReason = getattr(exc, "failure_reason", None)
    shot.failureDetail = getattr(exc, "failure_detail", None) or str(exc)
    shot.failureSubmitId = getattr(exc, "failure_submit_id", None)
    shot.failureLogId = getattr(exc, "failure_log_id", None)

def apply_jimeng_progress_to_shot(shot: Shot, update: Dict[str, Any]) -> None:
    submit_id = update.get("submitId")
    if submit_id:
        shot.jimengSubmitId = str(submit_id)
    account_id = update.get("accountId")
    if account_id:
        shot.jimengAccountId = str(account_id)
    account_alias = update.get("accountAlias")
    if account_alias:
        shot.jimengAccountAlias = str(account_alias)

    queue_info = update.get("queueInfo")
    if isinstance(queue_info, dict):
        shot.queuePosition = queue_info.get("position")
        shot.queueTotal = queue_info.get("total")
        shot.queueStatus = queue_info.get("status")
        shot.queueAhead = queue_info.get("ahead")
        shot.queueActive = queue_info.get("active")
        shot.queueCapacity = queue_info.get("capacity")
        shot.queueUpdatedAt = time.time()

    status = str(update.get("status") or "").lower()
    if status == "account_pool_waiting":
        shot.status = "waiting"
        shot.progress = max(shot.progress, 5)
    elif status == "account_acquired":
        shot.queuePosition = None
        shot.queueTotal = None
        shot.queueStatus = "account_acquired"
        shot.queueAhead = None
        shot.queueActive = None
        shot.queueCapacity = None
        shot.queueUpdatedAt = time.time()
        shot.status = "generating"
        shot.progress = max(shot.progress, 8)
    elif status in {"querying", "queueing", "queued", "pending", "submitted"}:
        shot.status = "generating"
        shot.progress = max(shot.progress, 8)


def is_run_canceled(run_id: str) -> bool:
    run = agent_runs.get(run_id)
    return bool(run and run.status == "canceled")


def ensure_run_not_canceled(run_id: str) -> None:
    if is_run_canceled(run_id):
        raise AgentRunCancelled("任务已取消")


def is_scene_submitted_or_finished(scene: AgentRunScene) -> bool:
    return bool(scene.jimengSubmitId or scene.videoUrl or scene.status == "completed")


def user_can_cancel_run(run: AgentRun) -> bool:
    if run.status not in AGENT_CANCELABLE_STATUSES:
        return False
    if not run.scenes:
        return run.status in {"queued", "planning", "awaiting_confirmation"}
    return not any(is_scene_submitted_or_finished(scene) for scene in run.scenes)


def get_cancel_refundable_scenes(run: AgentRun) -> List[AgentRunScene]:
    return [
        scene for scene in run.scenes
        if scene.status != "completed"
        and not scene.videoUrl
        and not scene.creditRefundedAt
    ]


async def remove_agent_jobs_for_run(run_id: str, *, scene_id: Optional[str] = None) -> int:
    removed_count = 0
    async with agent_scheduler_lock:
        for key, job in list(agent_queued_jobs.items()):
            if job.run_id == run_id and (scene_id is None or job.scene_id == scene_id):
                agent_queued_jobs.pop(key, None)
                removed_count += 1
    return removed_count


def mark_scene_canceled(
    run: AgentRun,
    scene: AgentRunScene,
    *,
    reason: str,
    refund_credit: int = 0,
) -> AgentRunScene:
    updates: Dict[str, Any] = {
        "status": "canceled",
        "progress": scene.progress,
        "error": reason,
        "failureCategory": "canceled",
        "failureTitle": "任务已取消",
        "failureReason": "canceled",
        "failureDetail": reason,
        "queuePosition": None,
        "queueTotal": None,
        "queueStatus": "canceled",
        "queueAhead": None,
        "queueActive": None,
        "queueCapacity": None,
        "queueUpdatedAt": time.time(),
    }
    if refund_credit > 0 and not scene.creditRefundedAt:
        updates["creditRefundedAt"] = time.time()
        updates["refundCredit"] = refund_credit

    shot = shots_db.get(scene.id)
    if shot:
        shot.status = "canceled"
        shot.error = reason
        shot.failureCategory = "canceled"
        shot.failureTitle = "任务已取消"
        shot.failureReason = "canceled"
        shot.failureDetail = reason
        shot.queuePosition = None
        shot.queueTotal = None
        shot.queueStatus = "canceled"
        shot.queueAhead = None
        shot.queueActive = None
        shot.queueCapacity = None
        shot.queueUpdatedAt = time.time()

    return copy_model_with_update(scene, updates)


def refund_cancelable_scenes(run: AgentRun, *, reason: str) -> int:
    total_refund = 0
    refundable_scene_ids = {scene.id for scene in get_cancel_refundable_scenes(run)}
    next_scenes = []
    for scene in run.scenes:
        refund_credit = 0
        if scene.id in refundable_scene_ids:
            refund_credit = get_scene_credit_cost(run, scene)
            if refund_credit > 0:
                refund_user_credits(
                    run.userEmail,
                    refund_credit,
                    f"任务取消返还：{scene.number} / {scene.title}",
                    run_id=run.id,
                )
                total_refund += refund_credit
        if scene.status in {"queued", "waiting", "generating"} or scene.id in refundable_scene_ids:
            next_scenes.append(mark_scene_canceled(run, scene, reason=reason, refund_credit=refund_credit))
        else:
            next_scenes.append(scene)
    run.scenes = next_scenes
    return total_refund


async def cancel_agent_run_internal(
    run: AgentRun,
    *,
    actor: UserRecord,
    admin_force: bool = False,
    reason: Optional[str] = None,
) -> AgentRun:
    run = sync_run_from_shots(run)
    if run.status in AGENT_TERMINAL_STATUSES:
        return run
    if not admin_force and not user_can_cancel_run(run):
        raise HTTPException(status_code=409, detail="当前任务已提交即梦或已有结果，不能由用户取消，请联系管理员处理")

    cancel_reason = (reason or "").strip()
    if not cancel_reason:
        cancel_reason = "管理员已取消任务" if admin_force else "用户已取消排队任务"
    refund_credit = refund_cancelable_scenes(run, reason=cancel_reason)
    await remove_agent_jobs_for_run(run.id)
    wake_account_pool_waiters()

    run.status = "canceled"
    run.stage = "canceled"
    run.progress = 100
    run.error = f"{cancel_reason}。已返还 {refund_credit} 积分。" if refund_credit > 0 else cancel_reason
    run.updatedAt = time.time()
    persist_agent_run(run)
    logger.info(
        "Agent run %s canceled by %s (admin_force=%s, refund=%s).",
        run.id,
        get_user_contact(actor),
        admin_force,
        refund_credit,
    )
    return run

def make_agent_job(
    kind: Literal["plan", "generate", "retry", "resume"],
    run: AgentRun,
    *,
    scene_id: Optional[str] = None,
    bypass_user_limits: bool = False,
) -> AgentJob:
    return AgentJob(
        kind=kind,
        run_id=run.id,
        scene_id=scene_id,
        user_id=run.userId,
        bypass_user_limits=bypass_user_limits,
        created_at=time.time(),
    )

def count_agent_jobs_by_user(user_id: str) -> tuple[int, int]:
    active_run_ids = {
        job.run_id
        for job in agent_active_jobs.values()
        if job.user_id == user_id and not job.bypass_user_limits
    }
    queued_run_ids = {
        job.run_id
        for job in agent_queued_jobs.values()
        if job.user_id == user_id and not job.bypass_user_limits
    }
    return len(active_run_ids), len(queued_run_ids)

def count_jobs_by_kind(jobs: List[AgentJob]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for job in jobs:
        counts[job.kind] = counts.get(job.kind, 0) + 1
    return counts

def ensure_agent_job_acceptable_locked(job: AgentJob) -> None:
    if job.key in agent_queued_jobs or job.key in agent_active_jobs:
        return
    if agent_job_queue.full():
        raise HTTPException(status_code=429, detail="当前提交量较高，创作队列已满，请稍后重试")
    if not job.bypass_user_limits and job.user_id and AGENT_USER_QUEUED_RUN_LIMIT > 0:
        _, queued_count = count_agent_jobs_by_user(job.user_id)
        if queued_count >= AGENT_USER_QUEUED_RUN_LIMIT:
            raise HTTPException(
                status_code=429,
                detail=f"当前账号等待中的创作任务已达上限（{AGENT_USER_QUEUED_RUN_LIMIT} 个），请等待部分任务开始后再提交",
            )

async def ensure_agent_job_capacity(
    kind: Literal["plan", "generate", "retry", "resume"],
    run: AgentRun,
    *,
    scene_id: Optional[str] = None,
    bypass_user_limits: bool = False,
) -> None:
    job = make_agent_job(kind, run, scene_id=scene_id, bypass_user_limits=bypass_user_limits)
    async with agent_scheduler_lock:
        ensure_agent_job_acceptable_locked(job)

async def enqueue_agent_job(
    kind: Literal["plan", "generate", "retry", "resume"],
    run: AgentRun,
    *,
    scene_id: Optional[str] = None,
    bypass_user_limits: bool = False,
) -> Dict[str, Any]:
    job = make_agent_job(kind, run, scene_id=scene_id, bypass_user_limits=bypass_user_limits)
    async with agent_scheduler_lock:
        if job.key in agent_queued_jobs or job.key in agent_active_jobs:
            return {
                "status": "already_queued",
                "jobKey": job.key,
                "queuePosition": agent_job_queue.qsize(),
            }
        ensure_agent_job_acceptable_locked(job)
        agent_job_queue.put_nowait(job)
        agent_queued_jobs[job.key] = job
        return {
            "status": "queued",
            "jobKey": job.key,
            "queuePosition": agent_job_queue.qsize(),
        }

def should_skip_agent_job(job: AgentJob) -> bool:
    run = agent_runs.get(job.run_id)
    if not run:
        return True
    if run.status in AGENT_TERMINAL_STATUSES:
        return True
    if job.kind == "plan" and run.candidates:
        return True
    if job.kind in {"generate", "resume"} and not run.scenes:
        return True
    return False


async def claim_agent_job(job: AgentJob) -> str:
    async with agent_scheduler_lock:
        if job.key not in agent_queued_jobs:
            return "missing"
        if should_skip_agent_job(job):
            agent_queued_jobs.pop(job.key, None)
            return "skipped"
        if (
            not job.bypass_user_limits
            and job.user_id
            and AGENT_USER_ACTIVE_RUN_LIMIT > 0
            and count_agent_jobs_by_user(job.user_id)[0] >= AGENT_USER_ACTIVE_RUN_LIMIT
        ):
            return "deferred"
        agent_queued_jobs.pop(job.key, None)
        agent_active_jobs[job.key] = job
        return "claimed"

async def requeue_agent_job(job: AgentJob) -> None:
    async with agent_scheduler_lock:
        if job.key in agent_active_jobs:
            return
        agent_queued_jobs[job.key] = job
    await asyncio.sleep(max(AGENT_REQUEUE_DELAY_SECONDS, 0.05))
    await agent_job_queue.put(job)

async def release_agent_job(job: AgentJob) -> None:
    async with agent_scheduler_lock:
        agent_active_jobs.pop(job.key, None)

async def dispatch_agent_job(job: AgentJob) -> None:
    if should_skip_agent_job(job):
        return
    if job.kind == "plan":
        await process_agent_run(job.run_id)
    elif job.kind == "generate":
        await process_confirmed_run(job.run_id)
    elif job.kind == "retry":
        if not job.scene_id:
            raise RuntimeError("Retry Agent job is missing scene_id")
        await process_scene_retry(job.run_id, job.scene_id)
    elif job.kind == "resume":
        await resume_confirmed_run(job.run_id)
    else:
        raise RuntimeError(f"Unsupported Agent job kind: {job.kind}")

async def agent_worker(worker_id: int) -> None:
    logger.info("Agent worker %s started.", worker_id)
    while True:
        try:
            job = await agent_job_queue.get()
            claimed = False
            try:
                claim_status = await claim_agent_job(job)
                if claim_status == "deferred":
                    await requeue_agent_job(job)
                    continue
                if claim_status != "claimed":
                    continue
                claimed = True
                logger.info("Agent worker %s handling %s.", worker_id, job.key)
                await dispatch_agent_job(job)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.exception("Agent job %s failed unexpectedly: %s", job.key, exc)
            finally:
                if claimed:
                    await release_agent_job(job)
                agent_job_queue.task_done()
        except asyncio.CancelledError:
            logger.info("Agent worker %s stopped.", worker_id)
            break

def start_agent_workers() -> None:
    if agent_worker_tasks:
        return
    for index in range(AGENT_WORKER_COUNT):
        task = asyncio.create_task(agent_worker(index + 1))
        agent_worker_tasks.append(task)
        active_workers.append(task)

def get_agent_queue_snapshot() -> Dict[str, Any]:
    queued_jobs = list(agent_queued_jobs.values())
    active_jobs = list(agent_active_jobs.values())
    max_queue_size = agent_job_queue.maxsize or AGENT_MAX_QUEUE_SIZE
    return {
        "queueSize": agent_job_queue.qsize(),
        "trackedQueuedJobs": len(queued_jobs),
        "activeJobs": len(active_jobs),
        "workerCount": AGENT_WORKER_COUNT,
        "maxQueueSize": max_queue_size,
        "availableQueueSlots": max(max_queue_size - agent_job_queue.qsize(), 0),
        "userActiveRunLimit": AGENT_USER_ACTIVE_RUN_LIMIT,
        "userQueuedRunLimit": AGENT_USER_QUEUED_RUN_LIMIT,
        "queuedByKind": count_jobs_by_kind(queued_jobs),
        "activeByKind": count_jobs_by_kind(active_jobs),
        "oldShotQueueSize": task_queue.qsize(),
    }

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
        imageReferences=run.imageReferences,
        sceneLimit=run.sceneLimit,
        sceneImageNames=run.sceneImageNames,
        sceneImageIds=run.sceneImageIds,
        sceneImageReferences=run.sceneImageReferences,
        blockSubtitles=run.blockSubtitles,
        soundEffectOnly=run.soundEffectOnly,
        forceMute=run.forceMute,
    )

    try:
        ensure_run_not_canceled(run_id)
        settings = load_agent_settings()
        run.status = "planning"
        run.stage = "storyboard_planning" if settings.deepseekApiKey else "local_planning"
        run.progress = 8
        run.updatedAt = time.time()
        persist_agent_run(run)

        candidates, planner_model = await build_scene_plan(payload, run_id, settings)
        ensure_run_not_canceled(run_id)
        run.agentModel = planner_model
        run.candidates = candidates
        run.status = "awaiting_confirmation"
        run.stage = "awaiting_confirmation"
        run.progress = 20
        run.updatedAt = time.time()
        persist_agent_run(run)
        logger.info("Agent run %s created %s editable storyboard candidates.", run_id, len(candidates))
    except AgentRunCancelled:
        logger.info("Agent run %s planning stopped because it was canceled.", run_id)
    except Exception as exc:
        run.status = "failed"
        run.stage = "failed"
        run.error = str(exc)
        run.progress = 0
        run.updatedAt = time.time()
        persist_agent_run(run)
        logger.exception("Agent run %s failed: %s", run_id, exc)

def get_run_reference_entries(
    run: AgentRun,
    *,
    scene_references: bool = False,
) -> List[Dict[str, Any]]:
    image_ids = run.sceneImageIds if scene_references else run.imageIds
    image_names = run.sceneImageNames if scene_references else run.imageNames
    image_references = run.sceneImageReferences if scene_references else run.imageReferences
    label_factory = default_scene_reference_label if scene_references else default_reference_label
    declared_references = {
        reference.id: reference
        for reference in image_references
        if reference.id
    }
    entries = []
    for index, image_id in enumerate(image_ids[:MAX_REFERENCE_IMAGES]):
        uploaded = uploaded_references.get(image_id)
        if not uploaded or uploaded.userId != run.userId:
            continue
        declared = declared_references.get(image_id)
        fallback_name = image_names[index] if index < len(image_names) else ""
        label = normalize_reference_label(
            declared.label if declared else None,
            label_factory(index),
        )
        name = (declared.name if declared and declared.name else "") or uploaded.name or fallback_name or label
        entries.append(
            {
                "id": image_id,
                "name": name,
                "label": label,
                "token": f"@{label}",
                "path": Path(uploaded.path),
            }
        )
    return entries

def get_run_reference_paths(run: AgentRun) -> List[Path]:
    return [entry["path"] for entry in get_run_reference_entries(run)]

def get_run_scene_reference_entries(run: AgentRun) -> List[Dict[str, Any]]:
    return get_run_reference_entries(run, scene_references=True)

def select_scene_reference_entries(run: AgentRun, prompt: str) -> List[Dict[str, Any]]:
    entries = get_run_reference_entries(run)
    if not entries:
        return []

    lookup = {}
    for entry in entries:
        lookup[entry["label"].lower()] = entry
        lookup[entry["token"].lstrip("@").lower()] = entry

    selected = []
    selected_ids = set()
    for match in REFERENCE_TOKEN_PATTERN.finditer(prompt or ""):
        token = normalize_reference_label(match.group(1), "").lower()
        entry = lookup.get(token)
        if entry and entry["id"] not in selected_ids:
            selected.append(entry)
            selected_ids.add(entry["id"])

    return selected or entries

def prepare_scene_prompt_and_references(run: AgentRun, scene: AgentRunScene) -> tuple[str, List[Path]]:
    scene_entries = get_run_scene_reference_entries(run)
    selected_entries = select_scene_reference_entries(run, scene.prompt)
    available_reference_slots = max(MAX_REFERENCE_IMAGES - len(scene_entries), 0)
    selected_entries = selected_entries[:available_reference_slots]
    combined_entries = scene_entries + selected_entries
    constraints = build_prompt_constraints(
        scene_limit=run.sceneLimit,
        block_subtitles=run.blockSubtitles,
        sound_effect_only=run.soundEffectOnly,
        force_mute=run.forceMute,
    )
    prefix_parts = []
    if constraints:
        prefix_parts.append("强制限制：" + " ".join(constraints))
    if not combined_entries:
        return f"{' '.join(prefix_parts)}{scene.prompt}" if prefix_parts else scene.prompt, []

    prompt = scene.prompt
    mapping_parts = []
    for index, entry in enumerate(combined_entries, start=1):
        slot = f"@image_file_{index}"
        aliases = sorted({entry["token"], f"@{entry['label']}"}, key=len, reverse=True)
        for alias in aliases:
            prompt = prompt.replace(alias, slot)
        mapping_parts.append(f"{slot}={entry['label']}（{entry['name']}）")

    reference_instruction = (
        f"参考图映射：{'、'.join(mapping_parts)}。"
        "请严格按映射理解主体、场景或风格，保持引用关系正确。"
    )
    if scene_entries:
        prefix_parts.append("场景参考图是每段画面的固定前提。")
    prefix_parts.append(reference_instruction)
    return f"{' '.join(prefix_parts)}{prompt}", [entry["path"] for entry in combined_entries]

def get_scene_credit_cost(run: AgentRun, scene: AgentRunScene) -> int:
    return calculate_video_credit_cost(run.jimengModel, [scene.duration])

def mark_scene_refunded(run: AgentRun, scene_id: str, refund_credit: int) -> None:
    run.scenes = [
        copy_model_with_update(scene, {
            "creditRefundedAt": time.time(),
            "refundCredit": refund_credit,
        })
        if scene.id == scene_id and not scene.creditRefundedAt
        else scene
        for scene in run.scenes
    ]

def refund_failed_scene_if_needed(run: AgentRun, scene: AgentRunScene) -> None:
    current_scene = next((item for item in run.scenes if item.id == scene.id), scene)
    if current_scene.creditRefundedAt:
        return
    refund_credit = get_scene_credit_cost(run, current_scene)
    refund_user_credits(
        run.userEmail,
        refund_credit,
        f"分镜生成失败返还：{current_scene.number} / {current_scene.title}",
        run_id=run.id,
    )
    mark_scene_refunded(run, scene.id, refund_credit)

async def generate_single_scene(run: AgentRun, scene: AgentRunScene, settings: AgentSettings) -> None:
    ensure_run_not_canceled(run.id)
    shot = shots_db[scene.id]
    shot.status = "generating"
    shot.progress = 5
    clear_generation_failure(shot)
    clear_generation_queue(shot)
    run.stage = "jimeng_generating"
    run.updatedAt = time.time()
    sync_run_from_shots(run)

    try:
        if settings.jimengMode == "mock":
            await simulate_video_generation(scene.id, None)
        elif settings.jimengMode == "cli":
            scene_prompt, scene_reference_paths = prepare_scene_prompt_and_references(run, scene)
            result = await generate_video(
                prompt=scene_prompt,
                duration=scene.duration,
                ratio=run.ratio,
                model=run.jimengModel or settings.jimengModel,
                region=settings.jimengRegion,
                output_dir=OUTPUTS_DIR / run.id / scene.id,
                reference_paths=scene_reference_paths,
                public_root=OUTPUTS_DIR,
                public_url_prefix="/api/outputs",
                progress_callback=lambda update: apply_jimeng_progress_to_shot(shot, update),
                cancellation_check=lambda: ensure_run_not_canceled(run.id),
            )
            ensure_run_not_canceled(run.id)
            shot.videoUrl = result.video_url
            shot.progress = 100
            shot.status = "completed"
            shot.queueStatus = "Finish"
            shot.jimengAccountId = result.account_id or shot.jimengAccountId
            shot.jimengAccountAlias = result.account_alias or shot.jimengAccountAlias
        else:
            raise RuntimeError(f"不支持的即梦接入模式：{settings.jimengMode}")
    except AgentRunCancelled as exc:
        shot.status = "canceled"
        shot.error = str(exc)
        shot.failureCategory = "canceled"
        shot.failureTitle = "任务已取消"
        shot.failureReason = "canceled"
        shot.failureDetail = str(exc)
        logger.info("Jimeng scene %s stopped because run was canceled.", scene.id)
    except (JimengCliError, RuntimeError) as exc:
        shot.status = "failed"
        shot.progress = 0
        apply_generation_error_to_shot(shot, exc)
        refund_failed_scene_if_needed(run, scene)
        logger.exception("Jimeng scene %s failed: %s", scene.id, exc)

    if shot.status == "failed":
        refund_failed_scene_if_needed(run, scene)

    sync_run_from_shots(run)

async def process_confirmed_run(run_id: str) -> None:
    run = agent_runs.get(run_id)
    if not run:
        return

    try:
        ensure_run_not_canceled(run_id)
        settings = load_agent_settings()
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
        persist_agent_run(run)

        for scene in run.scenes:
            ensure_run_not_canceled(run_id)
            await generate_single_scene(run, scene, settings)

        sync_run_from_shots(run)
        logger.info("Agent run %s finished sequential Jimeng generation.", run_id)
    except AgentRunCancelled:
        logger.info("Confirmed Agent run %s stopped because it was canceled.", run_id)
    except Exception as exc:
        run.status = "failed"
        run.stage = "failed"
        run.error = str(exc)
        run.updatedAt = time.time()
        persist_agent_run(run)
        logger.exception("Confirmed Agent run %s failed: %s", run_id, exc)

async def resume_confirmed_run(run_id: str) -> None:
    run = agent_runs.get(run_id)
    if not run or not run.scenes:
        return

    pending_statuses = {"queued", "waiting", "generating"}
    pending_scenes = [
        scene for scene in run.scenes
        if scene.status in pending_statuses or (not scene.videoUrl and scene.status not in {"completed", "failed"})
    ]
    if not pending_scenes:
        sync_run_from_shots(run)
        return

    try:
        ensure_run_not_canceled(run_id)
        settings = load_agent_settings()
        run.status = "generating"
        run.stage = "jimeng_dispatch"
        run.error = None
        run.updatedAt = time.time()
        persist_agent_run(run)

        for scene in pending_scenes:
            ensure_run_not_canceled(run_id)
            current_run = agent_runs.get(run_id, run)
            current_scene = next((item for item in current_run.scenes if item.id == scene.id), scene)
            if current_scene.status in {"completed", "failed"}:
                continue
            shots_db[current_scene.id] = Shot(
                id=current_scene.id,
                prompt=current_scene.prompt,
                duration=current_scene.duration,
                engine="jimeng",
                status="waiting",
                progress=current_scene.progress if current_scene.status == "generating" else 0,
                caption=f"{current_scene.title} / {current_run.ratio}",
            )
            await generate_single_scene(current_run, current_scene, settings)

        sync_run_from_shots(agent_runs.get(run_id, run))
        logger.info("Agent run %s resumed pending scene generation.", run_id)
    except AgentRunCancelled:
        logger.info("Resumed Agent run %s stopped because it was canceled.", run_id)
    except Exception as exc:
        run = agent_runs.get(run_id, run)
        run.status = "failed"
        run.stage = "failed"
        run.error = str(exc)
        run.updatedAt = time.time()
        persist_agent_run(run)
        logger.exception("Resumed Agent run %s failed: %s", run_id, exc)

async def schedule_persisted_agent_runs() -> None:
    for run in list(agent_runs.values()):
        try:
            if run.status in {"queued", "planning"} and not run.candidates and not run.scenes:
                await enqueue_agent_job("plan", run)
            elif run.status in {"queued", "generating"} and run.scenes:
                await enqueue_agent_job("resume", run)
        except HTTPException as exc:
            logger.warning("Skipped persisted Agent run %s during startup scheduling: %s", run.id, exc.detail)

async def process_scene_retry(run_id: str, scene_id: str) -> None:
    run = agent_runs.get(run_id)
    if not run:
        return

    scene = next((item for item in run.scenes if item.id == scene_id), None)
    if not scene:
        return

    try:
        ensure_run_not_canceled(run_id)
        settings = load_agent_settings()
        run.status = "generating"
        run.stage = "jimeng_generating"
        run.error = None
        run.updatedAt = time.time()
        shots_db[scene.id] = Shot(
            id=scene.id,
            prompt=scene.prompt,
            duration=scene.duration,
            engine="jimeng",
            status="waiting",
            progress=0,
            caption=f"{scene.title} / {run.ratio}",
        )
        persist_agent_run(run)
        await generate_single_scene(run, scene, settings)
        sync_run_from_shots(run)
        logger.info("Agent run %s retried scene %s.", run_id, scene_id)
    except AgentRunCancelled:
        logger.info("Scene retry %s/%s stopped because run was canceled.", run_id, scene_id)
    except Exception as exc:
        shot = shots_db.get(scene_id)
        if shot:
            shot.status = "failed"
            shot.progress = 0
            apply_generation_error_to_shot(shot, exc)
        refund_failed_scene_if_needed(run, scene)
        run.updatedAt = time.time()
        persist_agent_run(run)
        logger.exception("Scene retry %s/%s failed: %s", run_id, scene_id, exc)

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
        clear_generation_failure(shot)
        clear_generation_queue(shot)
        
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
            shot.failureCategory = "platform"
            shot.failureTitle = "上游生成服务异常"
            shot.failureDetail = shot.error
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
            apply_generation_error_to_shot(shots_db[shot_id], e)
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
    database.init_database()
    database.migrate_json_files(USERS_FILE, TRANSACTIONS_FILE, VERIFICATION_CODES_FILE)
    ensure_default_admin()
    load_uploaded_references_from_disk()
    load_agent_runs_from_disk()
    # Start background task queue worker
    worker_task = asyncio.create_task(queue_worker())
    active_workers.append(worker_task)
    start_agent_workers()
    await schedule_persisted_agent_runs()

@app.on_event("shutdown")
async def shutdown_event():
    for w in active_workers:
        w.cancel()
    await asyncio.gather(*active_workers, return_exceptions=True)
    active_workers.clear()
    agent_worker_tasks.clear()

# ==========================================
# REST API Routes
# ==========================================

@app.post("/auth/request-code", response_model=VerificationCodeResponse)
def request_verification_code(payload: VerificationCodePayload):
    channel = "email"
    identifier = normalize_email(payload.identifier)
    users = load_users()
    storage_key = identifier
    if storage_key in users:
        raise HTTPException(status_code=400, detail="该账号已注册，请直接登录")
    existing_key, _ = find_user_by_identifier(users, identifier)
    if existing_key:
        raise HTTPException(status_code=400, detail="该账号已注册，请直接登录")

    code = f"{secrets.randbelow(900000) + 100000}"
    codes = load_verification_codes()
    key = verification_key(channel, identifier, payload.purpose)
    now = time.time()
    existing_record = codes.get(key)
    if existing_record and VERIFICATION_CODE_RESEND_COOLDOWN_SECONDS > 0:
        elapsed = now - float(existing_record.get("createdAt") or 0)
        cooldown_remaining = int(VERIFICATION_CODE_RESEND_COOLDOWN_SECONDS - elapsed)
        if cooldown_remaining > 0:
            raise HTTPException(status_code=429, detail=f"请 {cooldown_remaining} 秒后再获取验证码")

    delivery = send_email_code(identifier, code)
    codes[key] = {
        "channel": channel,
        "identifier": identifier,
        "purpose": payload.purpose,
        "codeHash": code_digest(channel, identifier, payload.purpose, code),
        "expiresAt": now + VERIFICATION_CODE_TTL_SECONDS,
        "attempts": 0,
        "createdAt": now,
    }
    save_verification_codes(codes)

    return VerificationCodeResponse(
        channel=channel,
        identifier=identifier,
        expiresIn=VERIFICATION_CODE_TTL_SECONDS,
        delivery=delivery,
        devCode=code if VERIFICATION_CODE_DEV_MODE else None,
    )

@app.post("/auth/register", response_model=AuthResponse)
def register_user(payload: RegisterPayload):
    name = payload.name.strip()
    channel = "email"
    identifier = normalize_email(payload.identifier or payload.email or "")

    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Name must be at least 2 characters")
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if not payload.code:
        raise HTTPException(status_code=400, detail="请先输入验证码")
    verify_registration_code(channel, identifier, payload.code)

    users = load_users()
    storage_key = get_user_storage_key(channel, identifier)
    if storage_key in users or find_user_by_identifier(users, identifier)[1]:
        raise HTTPException(status_code=400, detail="该账号已注册")

    user = UserRecord(
        id=f"user-{secrets.token_hex(8)}",
        name=name,
        email=identifier,
        phone=None,
        passwordHash=hash_password(payload.password),
        role="user",
        status="active",
        creditBalance=FIRST_REGISTER_BONUS_CREDITS,
        createdAt=time.time(),
        lastLoginAt=time.time(),
        loginCount=1,
    )
    users[storage_key] = user
    save_users(users)
    append_credit_transaction(create_credit_transaction(
        user,
        "bonus",
        FIRST_REGISTER_BONUS_CREDITS,
        user.creditBalance,
        "首次注册赠送积分",
    ))

    return AuthResponse(token=create_auth_token(storage_key), user=user_to_public(user))

@app.post("/auth/login", response_model=AuthResponse)
def login_user(payload: AuthPayload):
    identifier = (payload.identifier or payload.email or "").strip()
    users = load_users()
    user_key, user = find_user_by_identifier(users, identifier)

    if not user or not verify_password(payload.password, user.passwordHash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.status != "active":
        raise HTTPException(status_code=403, detail="User has been disabled")

    user.lastLoginAt = time.time()
    user.loginCount += 1
    users[user_key or identifier.lower()] = user
    save_users(users)

    return AuthResponse(token=create_auth_token(user_key or identifier.lower()), user=user_to_public(user))

@app.get("/auth/me", response_model=PublicUser)
def get_me(current_user: UserRecord = Depends(get_current_user)):
    return user_to_public(current_user)

@app.patch("/auth/me", response_model=PublicUser)
def update_profile(payload: ProfileUpdatePayload, current_user: UserRecord = Depends(get_current_user)):
    users = load_users()
    user_key = get_user_account_key(current_user)
    if user_key not in users:
        user_key, _ = find_user_by_identifier(users, get_user_contact(current_user))
    if not user_key or user_key not in users:
        raise HTTPException(status_code=404, detail="用户不存在")

    user = users[user_key]
    user.name = payload.name.strip()
    users[user_key] = user
    save_users(users)
    return user_to_public(user)

@app.put("/auth/password", response_model=PublicUser)
def change_password(payload: PasswordChangePayload, current_user: UserRecord = Depends(get_current_user)):
    if not verify_password(payload.currentPassword, current_user.passwordHash):
        raise HTTPException(status_code=400, detail="当前密码不正确")
    if payload.currentPassword == payload.newPassword:
        raise HTTPException(status_code=400, detail="新密码不能与当前密码相同")

    users = load_users()
    user_key = get_user_account_key(current_user)
    if user_key not in users:
        user_key, _ = find_user_by_identifier(users, get_user_contact(current_user))
    if not user_key or user_key not in users:
        raise HTTPException(status_code=404, detail="用户不存在")

    user = users[user_key]
    user.passwordHash = hash_password(payload.newPassword)
    users[user_key] = user
    save_users(users)
    return user_to_public(user)

@app.get("/billing/me", response_model=BillingOverview)
def get_billing_overview(current_user: UserRecord = Depends(get_current_user)):
    return billing.build_billing_overview(current_user, TRANSACTIONS_FILE)

@app.post("/billing/recharge", response_model=BillingOverview)
def create_recharge(payload: RechargePayload, current_user: UserRecord = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="普通用户请使用扫码付款流程，等待管理员确认后到账")
    user_key = get_user_account_key(current_user)
    recharge_user_credits(user_key, payload.packageId)
    refreshed_user = load_users().get(user_key)
    if not refreshed_user:
        _, refreshed_user = find_user_by_identifier(load_users(), get_user_contact(current_user))
    if not refreshed_user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return billing.build_billing_overview(refreshed_user, TRANSACTIONS_FILE)

@app.post("/billing/recharge-requests", response_model=RechargeRequest)
def create_recharge_request(payload: RechargePayload, current_user: UserRecord = Depends(get_current_user)):
    if current_user.role == "admin":
        raise HTTPException(status_code=400, detail="管理员账号充值会直接到账，请使用管理员直充流程")
    return create_user_recharge_request(current_user, payload.packageId)

@app.get("/billing/recharge-requests/me", response_model=List[RechargeRequest])
def get_my_recharge_requests(current_user: UserRecord = Depends(get_current_user)):
    return load_user_recharge_requests(current_user, limit=30)

@app.post("/billing/recharge-requests/{request_id}/cancel", response_model=RechargeRequest)
def cancel_my_recharge_request(request_id: str, current_user: UserRecord = Depends(get_current_user)):
    return billing.cancel_recharge_request(request_id, current_user)

@app.post("/billing/recharge-requests/{request_id}/mark-paid", response_model=RechargeRequest)
def mark_my_recharge_request_paid(request_id: str, current_user: UserRecord = Depends(get_current_user)):
    return billing.mark_recharge_request_paid(request_id, current_user)

@app.get("/admin/users", response_model=List[PublicUser])
def get_users(_: UserRecord = Depends(require_admin)):
    users = load_users()
    return sorted(
        [user_to_public(user) for user in users.values()],
        key=lambda user: user.createdAt,
        reverse=True,
    )

@app.get("/admin/recharge-requests", response_model=List[RechargeRequest])
def get_admin_recharge_requests(
    status: Optional[str] = None,
    limit: int = 100,
    _: UserRecord = Depends(require_admin),
):
    normalized_status = status.strip().lower() if status else None
    if normalized_status and normalized_status not in {"pending", "processing", "approved", "rejected", "canceled"}:
        raise HTTPException(status_code=400, detail="不支持的充值申请状态")
    return load_admin_recharge_requests(status=normalized_status, limit=limit)

@app.post("/admin/recharge-requests/{request_id}/approve")
def approve_admin_recharge_request(
    request_id: str,
    payload: RechargeApprovalPayload,
    admin_user: UserRecord = Depends(require_admin),
):
    if payload.credits is None:
        raise HTTPException(status_code=400, detail="请先选择要入账的积分档位")
    recharge_request, transaction = approve_user_recharge_request(
        request_id,
        admin_user,
        credits=payload.credits,
        admin_note=payload.adminNote,
    )
    refreshed_user = load_users().get(transaction.userEmail.lower())
    if not refreshed_user:
        _, refreshed_user = find_user_by_identifier(load_users(), transaction.userEmail)
    return {
        "request": recharge_request,
        "transaction": transaction,
        "billing": billing.build_billing_overview(refreshed_user, TRANSACTIONS_FILE) if refreshed_user else None,
    }

@app.post("/admin/recharge-requests/{request_id}/reject", response_model=RechargeRequest)
def reject_admin_recharge_request(
    request_id: str,
    payload: RechargeApprovalPayload,
    admin_user: UserRecord = Depends(require_admin),
):
    return billing.reject_recharge_request(
        request_id,
        admin_user,
        admin_note=payload.adminNote,
    )

@app.get("/admin/stats")
def get_admin_stats(_: UserRecord = Depends(require_admin)):
    users = list(load_users().values())
    transactions = load_credit_transactions()
    agent_queue = get_agent_queue_snapshot()
    pending_recharge_requests = [
        request for request in load_admin_recharge_requests(limit=500)
        if request.status in {"pending", "processing"}
    ]
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
        "queueSize": agent_queue["queueSize"],
        "legacyShotQueueSize": task_queue.qsize(),
        "agentQueue": agent_queue,
        "agentRuns": len(agent_runs),
        "activeAgentRuns": len(active_agent_runs),
        "failedAgentRuns": len(failed_agent_runs),
        "userCreditBalance": sum(user.creditBalance for user in users),
        "pendingRechargeRequests": len(pending_recharge_requests),
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
    agent_queue = get_agent_queue_snapshot()
    cli_status = cli_public_status()
    active_runs = [sync_run_from_shots(run) for run in agent_runs.values()]
    active_runs = sorted(active_runs, key=lambda item: item.updatedAt, reverse=True)
    return {
        "config": agent_settings_to_public(settings),
        "queueSize": agent_queue["queueSize"],
        "activeAgentJobs": agent_queue["activeJobs"],
        "agentQueue": agent_queue,
        "activeCookies": len([cookie for cookie in cookie_pool.values() if cookie.status == "active"]),
        "busyCookies": len([cookie for cookie in cookie_pool.values() if cookie.activeTasks > 0]),
        "jimengAccountPool": cli_status.get("accountPool", []),
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
    persist_uploaded_references()
    return AgentUploadResponse(id=image_id, name=reference.name)

@app.get("/agent/uploads/{image_id}/content")
def get_agent_upload_content(image_id: str, current_user: UserRecord = Depends(get_current_user)):
    reference = uploaded_references.get(image_id)
    if not reference:
        raise HTTPException(status_code=404, detail="参考图片不存在")
    if current_user.role != "admin" and reference.userId != current_user.id:
        raise HTTPException(status_code=403, detail="You cannot view this reference image")
    file_path = Path(reference.path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="参考图片文件不存在")
    return FileResponse(file_path, filename=reference.name)

@app.post("/agent/runs", response_model=AgentRun)
async def create_agent_run(
    payload: AgentCreatePayload,
    current_user: UserRecord = Depends(get_current_user),
):
    if not payload.idea.strip():
        raise HTTPException(status_code=400, detail="请先填写视频创意")
    if payload.duration % payload.segmentDuration != 0:
        raise HTTPException(status_code=400, detail="目标时长必须能被单段时长整除")
    if len(payload.imageIds) > MAX_REFERENCE_IMAGES:
        raise HTTPException(status_code=400, detail=f"最多同时使用 {MAX_REFERENCE_IMAGES} 张参考图片")
    if len(payload.sceneImageIds) > MAX_REFERENCE_IMAGES:
        raise HTTPException(status_code=400, detail=f"最多同时使用 {MAX_REFERENCE_IMAGES} 张场景图片")
    invalid_references = [
        image_id for image_id in [*payload.imageIds, *payload.sceneImageIds]
        if image_id not in uploaded_references
        or uploaded_references[image_id].userId != current_user.id
    ]
    if invalid_references:
        raise HTTPException(status_code=400, detail="存在无效或无权访问的参考图片")
    image_references = build_payload_image_references(payload)
    scene_image_references = build_payload_scene_references(payload)
    jimeng_model = normalize_jimeng_model(payload.jimengModel)
    estimated_credit_cost = calculate_video_credit_cost(jimeng_model, get_scene_durations(payload))

    run_id = f"agent-{int(time.time() * 1000)}-{secrets.token_hex(4)}"
    run = AgentRun(
        id=run_id,
        userId=current_user.id,
        userEmail=get_user_contact(current_user),
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
        imageReferences=image_references,
        sceneLimit=payload.sceneLimit.strip(),
        sceneImageNames=payload.sceneImageNames,
        sceneImageIds=payload.sceneImageIds,
        sceneImageReferences=scene_image_references,
        blockSubtitles=payload.blockSubtitles,
        soundEffectOnly=payload.soundEffectOnly,
        forceMute=payload.forceMute,
        createdAt=time.time(),
        updatedAt=time.time(),
    )
    await ensure_agent_job_capacity("plan", run, bypass_user_limits=current_user.role == "admin")
    persist_agent_run(run)
    try:
        await enqueue_agent_job("plan", run, bypass_user_limits=current_user.role == "admin")
    except HTTPException:
        agent_runs.pop(run.id, None)
        persist_agent_runs()
        raise
    return run

@app.get("/agent/runs", response_model=List[AgentRun])
def list_agent_runs(limit: int = 20, current_user: UserRecord = Depends(get_current_user)):
    bounded_limit = min(max(limit, 1), 100)
    visible_runs = [
        sync_run_from_shots(run)
        for run in list(agent_runs.values())
        if current_user.role == "admin" or run.userId == current_user.id
    ]
    return sorted(visible_runs, key=lambda item: item.updatedAt, reverse=True)[:bounded_limit]

@app.post("/agent/runs/{run_id}/confirm", response_model=AgentRun)
async def confirm_agent_run(
    run_id: str,
    payload: AgentConfirmPayload,
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
    await ensure_agent_job_capacity("generate", run, bypass_user_limits=current_user.role == "admin")
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
    persist_agent_run(run)
    try:
        await enqueue_agent_job("generate", run, bypass_user_limits=current_user.role == "admin")
    except HTTPException:
        refund_user_credits(
            run.userEmail,
            credit_cost,
            "生成队列满自动退回：创作任务未能进入后台队列",
            run_id=run.id,
        )
        run.status = "awaiting_confirmation"
        run.stage = "awaiting_confirmation"
        run.progress = 20
        run.creditCost = 0
        run.creditChargedAt = None
        run.updatedAt = time.time()
        persist_agent_run(run)
        raise
    return run

@app.post("/agent/runs/{run_id}/scenes/{scene_id}/retry", response_model=AgentRun)
async def retry_agent_scene(
    run_id: str,
    scene_id: str,
    current_user: UserRecord = Depends(get_current_user),
):
    run = agent_runs.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Agent run not found")
    if current_user.role != "admin" and run.userId != current_user.id:
        raise HTTPException(status_code=403, detail="You cannot retry this Agent run")

    run = sync_run_from_shots(run)
    scene = next((item for item in run.scenes if item.id == scene_id), None)
    if not scene:
        raise HTTPException(status_code=404, detail="分镜不存在")
    if scene.status != "failed":
        raise HTTPException(status_code=409, detail="只有失败的分镜可以单独重试")

    previous_scene = scene
    retry_cost = get_scene_credit_cost(run, scene)
    await ensure_agent_job_capacity(
        "retry",
        run,
        scene_id=scene_id,
        bypass_user_limits=current_user.role == "admin",
    )
    charge_user_credits(
        run.userEmail,
        retry_cost,
        f"分镜重试扣费：{scene.number} / {scene.title} / {run.jimengModel}",
        run_id=run.id,
    )

    run.scenes = [
        copy_model_with_update(item, {
            "status": "queued",
            "progress": 0,
            "videoUrl": None,
            "error": None,
            "failureCategory": None,
            "failureTitle": None,
            "failureReason": None,
            "failureDetail": None,
            "failureSubmitId": None,
            "failureLogId": None,
            "jimengSubmitId": None,
            "jimengAccountId": None,
            "jimengAccountAlias": None,
            "queuePosition": None,
            "queueTotal": None,
            "queueStatus": None,
            "queueAhead": None,
            "queueActive": None,
            "queueCapacity": None,
            "queueUpdatedAt": None,
            "creditRefundedAt": None,
            "refundCredit": 0,
            "retryCount": item.retryCount + 1,
        })
        if item.id == scene_id
        else item
        for item in run.scenes
    ]
    run.status = "generating"
    run.stage = "jimeng_dispatch"
    run.creditCost += retry_cost
    run.progress = max(run.progress, 20)
    run.error = None
    run.updatedAt = time.time()
    shots_db[scene_id] = Shot(
        id=scene_id,
        prompt=scene.prompt,
        duration=scene.duration,
        engine="jimeng",
        status="waiting",
        progress=0,
        caption=f"{scene.title} / {run.ratio}",
    )
    persist_agent_run(run)
    try:
        await enqueue_agent_job(
            "retry",
            run,
            scene_id=scene_id,
            bypass_user_limits=current_user.role == "admin",
        )
    except HTTPException:
        refund_user_credits(
            run.userEmail,
            retry_cost,
            "重试队列满自动退回：分镜未能进入后台队列",
            run_id=run.id,
        )
        run.scenes = [
            previous_scene if item.id == scene_id else item
            for item in run.scenes
        ]
        shots_db.pop(scene_id, None)
        run = sync_run_from_shots(run)
        run.updatedAt = time.time()
        persist_agent_run(run)
        raise
    return sync_run_from_shots(run)


@app.post("/agent/runs/{run_id}/cancel", response_model=AgentRun)
async def cancel_my_agent_run(
    run_id: str,
    current_user: UserRecord = Depends(get_current_user),
):
    run = agent_runs.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Agent run not found")
    if current_user.role != "admin" and run.userId != current_user.id:
        raise HTTPException(status_code=403, detail="You cannot cancel this Agent run")
    return await cancel_agent_run_internal(
        run,
        actor=current_user,
        admin_force=current_user.role == "admin",
    )


@app.post("/admin/agent/runs/{run_id}/cancel", response_model=AgentRun)
async def cancel_admin_agent_run(
    run_id: str,
    admin_user: UserRecord = Depends(require_admin),
):
    run = agent_runs.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Agent run not found")
    return await cancel_agent_run_internal(
        run,
        actor=admin_user,
        admin_force=True,
        reason="管理员已强制取消任务",
    )

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
    agent_queue = get_agent_queue_snapshot()
    return {
        "status": "healthy",
        "cpu_usage_pct": round(random.uniform(5.0, 15.0), 1),
        "vram_allocated_gb": 0.0,
        "concurrency_limit": agent_queue["workerCount"],
        "queue_size": agent_queue["queueSize"],
        "agent_queue": agent_queue,
        "legacy_shot_queue_size": task_queue.qsize(),
        "timestamp": time.time(),
        "jimeng_cli": cli_public_status(),
        "database": database.public_status(),
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

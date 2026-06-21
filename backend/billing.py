import secrets
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from fastapi import HTTPException
from pydantic import BaseModel, Field

try:
    from . import database
except ImportError:
    import database

FIRST_REGISTER_BONUS_CREDITS = 15

SITE_CREDIT_PRICES_PER_5_SECONDS: Dict[str, int] = {
    "seedance2.0": 15,
    "seedance2.0fast": 10,
    "seedance2.0_vip": 70,
    "seedance2.0fast_vip": 45,
    "seedance2.0mini": 30,
}


class RechargePayload(BaseModel):
    packageId: str


class RechargePackage(BaseModel):
    id: str
    label: str
    credits: int
    priceCny: float
    originalPriceCny: Optional[float] = None
    firstPurchaseOnly: bool = False
    badge: Optional[str] = None


class RechargeRequest(BaseModel):
    id: str
    userId: str
    userEmail: str
    userName: str
    packageId: str
    packageLabel: str
    credits: int
    priceCny: float
    originalPriceCny: Optional[float] = None
    status: str = "pending"
    createdAt: float
    handledAt: Optional[float] = None
    handledBy: Optional[str] = None
    adminNote: Optional[str] = None


class RechargeApprovalPayload(BaseModel):
    credits: Optional[int] = Field(default=None, ge=1, le=100000)
    adminNote: Optional[str] = Field(default=None, max_length=200)


class CreditTransaction(BaseModel):
    id: str
    userId: str
    userEmail: str
    type: str
    amount: int
    balanceAfter: int
    description: str
    createdAt: float
    packageId: Optional[str] = None
    runId: Optional[str] = None
    priceCny: Optional[float] = None
    originalPriceCny: Optional[float] = None


class BillingOverview(BaseModel):
    balance: int
    firstRechargeAvailable: bool
    pricing: Dict[str, int]
    packages: List[RechargePackage]
    transactions: List[CreditTransaction] = Field(default_factory=list)


RECHARGE_PACKAGES: List[RechargePackage] = [
    RechargePackage(
        id="first_trial_50",
        label="首冲尝鲜",
        credits=50,
        priceCny=1,
        originalPriceCny=3,
        firstPurchaseOnly=True,
        badge="首充专享",
    ),
    RechargePackage(id="starter_100", label="轻量补给", credits=100, priceCny=6),
    RechargePackage(id="creator_500", label="创作包", credits=500, priceCny=28, originalPriceCny=30),
    RechargePackage(id="studio_1000", label="工作室包", credits=1000, priceCny=57, originalPriceCny=60),
]


def get_user_contact(user: Any) -> str:
    return str(getattr(user, "email", "") or getattr(user, "phone", "") or getattr(user, "id", ""))


def load_credit_transactions(_transactions_file: Path) -> List[CreditTransaction]:
    raw_transactions = database.load_credit_transactions()
    return [CreditTransaction(**item) for item in raw_transactions]


def save_credit_transactions(_transactions_file: Path, transactions: List[CreditTransaction]) -> None:
    database.save_credit_transactions(transactions)


def append_credit_transaction(_transactions_file: Path, transaction: CreditTransaction) -> None:
    database.append_credit_transaction(transaction)


def create_credit_transaction(
    user: Any,
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
    return CreditTransaction(
        id=f"credit-{int(time.time() * 1000)}-{secrets.token_hex(4)}",
        userId=user.id,
        userEmail=get_user_contact(user),
        type=transaction_type,
        amount=amount,
        balanceAfter=balance_after,
        description=description,
        createdAt=time.time(),
        packageId=package_id,
        runId=run_id,
        priceCny=price_cny,
        originalPriceCny=original_price_cny,
    )


def user_has_recharged(user: Any, transactions_file: Path) -> bool:
    if user.rechargeCount > 0:
        return True
    contact = get_user_contact(user).lower()
    return any(
        transaction.type == "recharge"
        and (
            transaction.userId == user.id
            or (contact and transaction.userEmail.lower() == contact)
        )
        for transaction in load_credit_transactions(transactions_file)
    )


def get_user_transactions(user: Any, transactions_file: Path, limit: int = 20) -> List[CreditTransaction]:
    contact = get_user_contact(user).lower()
    transactions = [
        transaction for transaction in load_credit_transactions(transactions_file)
        if transaction.userId == user.id or (contact and transaction.userEmail.lower() == contact)
    ]
    return sorted(transactions, key=lambda item: item.createdAt, reverse=True)[:limit]


def get_recharge_package(package_id: str) -> RechargePackage:
    for package in RECHARGE_PACKAGES:
        if package.id == package_id:
            return package
    raise HTTPException(status_code=400, detail="充值档位不存在")


def load_recharge_requests(
    *,
    status: Optional[str] = None,
    user_id: Optional[str] = None,
    user_email: Optional[str] = None,
    limit: int = 100,
) -> List[RechargeRequest]:
    raw_requests = database.load_recharge_requests(
        status=status,
        user_id=user_id,
        user_email=user_email,
        limit=limit,
    )
    return [RechargeRequest(**item) for item in raw_requests]


def get_recharge_request(request_id: str) -> RechargeRequest:
    raw_request = database.get_recharge_request(request_id)
    if not raw_request:
        raise HTTPException(status_code=404, detail="充值申请不存在")
    return RechargeRequest(**raw_request)


def get_user_recharge_requests(user: Any, limit: int = 20) -> List[RechargeRequest]:
    requests = load_recharge_requests(user_id=user.id, limit=limit)
    if requests:
        return requests
    contact = get_user_contact(user)
    if not contact:
        return []
    return load_recharge_requests(user_email=contact, limit=limit)


def create_recharge_request_for_user(
    user: Any,
    package_id: str,
    transactions_file: Path,
) -> RechargeRequest:
    package = get_recharge_package(package_id)
    if package.firstPurchaseOnly and user_has_recharged(user, transactions_file):
        raise HTTPException(status_code=400, detail="首充尝鲜包仅限首次充值")

    pending_requests = load_recharge_requests(status="pending", user_id=user.id, limit=50)
    for pending_request in pending_requests:
        if pending_request.packageId == package.id:
            return pending_request

    request = RechargeRequest(
        id=f"recharge-{int(time.time() * 1000)}-{secrets.token_hex(4)}",
        userId=user.id,
        userEmail=get_user_contact(user),
        userName=getattr(user, "name", "") or "未命名用户",
        packageId=package.id,
        packageLabel=package.label,
        credits=package.credits,
        priceCny=package.priceCny,
        originalPriceCny=package.originalPriceCny,
        status="pending",
        createdAt=time.time(),
    )
    return RechargeRequest(**database.create_recharge_request(request))


def calculate_video_credit_cost(
    model: str,
    durations: List[int],
    normalize_model: Callable[[str], str],
) -> int:
    normalized_model = normalize_model(model)
    price_per_5_seconds = SITE_CREDIT_PRICES_PER_5_SECONDS[normalized_model]
    return sum(max((int(duration) + 4) // 5, 1) * price_per_5_seconds for duration in durations)


def build_billing_overview(user: Any, transactions_file: Path) -> BillingOverview:
    return BillingOverview(
        balance=user.creditBalance,
        firstRechargeAvailable=not user_has_recharged(user, transactions_file),
        pricing=SITE_CREDIT_PRICES_PER_5_SECONDS,
        packages=RECHARGE_PACKAGES,
        transactions=get_user_transactions(user, transactions_file),
    )


def apply_recharge(users: Dict[str, Any], user_key: str, package_id: str, transactions_file: Path) -> CreditTransaction:
    storage_key = user_key.lower()
    user = users.get(storage_key)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    package = get_recharge_package(package_id)
    if package.firstPurchaseOnly and user_has_recharged(user, transactions_file):
        raise HTTPException(status_code=400, detail="首充尝鲜包仅限首次充值")

    user.creditBalance += package.credits
    user.rechargeCount += 1
    user.lifetimeRechargeCny = round(user.lifetimeRechargeCny + package.priceCny, 2)
    users[storage_key] = user

    transaction = create_credit_transaction(
        user,
        "recharge",
        package.credits,
        user.creditBalance,
        f"{package.label}：{package.credits} 积分",
        package_id=package.id,
        price_cny=package.priceCny,
        original_price_cny=package.originalPriceCny,
    )
    append_credit_transaction(transactions_file, transaction)
    return transaction


def find_user_for_recharge_request(
    users: Dict[str, Any],
    recharge_request: RechargeRequest,
) -> Tuple[str, Any]:
    for storage_key, user in users.items():
        if user.id == recharge_request.userId:
            return storage_key, user

    request_contact = (recharge_request.userEmail or "").lower()
    for storage_key, user in users.items():
        contact = get_user_contact(user).lower()
        if request_contact and contact == request_contact:
            return storage_key, user

    raise HTTPException(status_code=404, detail="充值申请对应用户不存在")


def apply_recharge_request_approval(
    users: Dict[str, Any],
    request_id: str,
    admin_user: Any,
    transactions_file: Path,
    *,
    credits: Optional[int] = None,
    admin_note: Optional[str] = None,
) -> Tuple[RechargeRequest, CreditTransaction]:
    recharge_request = get_recharge_request(request_id)
    if recharge_request.status != "pending":
        raise HTTPException(status_code=400, detail="该充值申请已处理")

    user_key, user = find_user_for_recharge_request(users, recharge_request)
    package = get_recharge_package(recharge_request.packageId)
    if package.firstPurchaseOnly and user_has_recharged(user, transactions_file):
        raise HTTPException(status_code=400, detail="该用户已完成过充值，不能再确认首充包")

    credited_amount = credits or recharge_request.credits
    if credited_amount <= 0:
        raise HTTPException(status_code=400, detail="入账积分必须大于 0")

    user.creditBalance += credited_amount
    user.rechargeCount += 1
    user.lifetimeRechargeCny = round(user.lifetimeRechargeCny + recharge_request.priceCny, 2)
    users[user_key] = user

    credit_label = f"{credited_amount} 积分"
    if credited_amount != recharge_request.credits:
        credit_label = f"手动入账 {credited_amount} 积分"
    transaction = create_credit_transaction(
        user,
        "recharge",
        credited_amount,
        user.creditBalance,
        f"管理员确认充值：{recharge_request.packageLabel}，{credit_label}",
        package_id=recharge_request.packageId,
        price_cny=recharge_request.priceCny,
        original_price_cny=recharge_request.originalPriceCny,
    )
    append_credit_transaction(transactions_file, transaction)

    updated_request = database.update_recharge_request(
        request_id,
        {
            "status": "approved",
            "handledAt": time.time(),
            "handledBy": get_user_contact(admin_user),
            "adminNote": admin_note or f"已入账 {credited_amount} 积分",
        },
    )
    if not updated_request:
        raise HTTPException(status_code=404, detail="充值申请不存在")
    return RechargeRequest(**updated_request), transaction


def reject_recharge_request(
    request_id: str,
    admin_user: Any,
    *,
    admin_note: Optional[str] = None,
) -> RechargeRequest:
    recharge_request = get_recharge_request(request_id)
    if recharge_request.status != "pending":
        raise HTTPException(status_code=400, detail="该充值申请已处理")

    updated_request = database.update_recharge_request(
        request_id,
        {
            "status": "rejected",
            "handledAt": time.time(),
            "handledBy": get_user_contact(admin_user),
            "adminNote": admin_note or "管理员已驳回",
        },
    )
    if not updated_request:
        raise HTTPException(status_code=404, detail="充值申请不存在")
    return RechargeRequest(**updated_request)


def cancel_recharge_request(request_id: str, user: Any) -> RechargeRequest:
    recharge_request = get_recharge_request(request_id)
    contact = get_user_contact(user).lower()
    if recharge_request.userId != user.id and recharge_request.userEmail.lower() != contact:
        raise HTTPException(status_code=403, detail="无权取消该充值订单")
    if recharge_request.status != "pending":
        raise HTTPException(status_code=400, detail="该充值订单已处理，无法取消")

    updated_request = database.update_recharge_request(
        request_id,
        {
            "status": "canceled",
            "handledAt": time.time(),
            "handledBy": get_user_contact(user),
            "adminNote": "用户已取消订单",
        },
    )
    if not updated_request:
        raise HTTPException(status_code=404, detail="充值申请不存在")
    return RechargeRequest(**updated_request)


def apply_debit(
    users: Dict[str, Any],
    user_key: str,
    amount: int,
    description: str,
    transactions_file: Path,
    run_id: Optional[str] = None,
) -> CreditTransaction:
    if amount <= 0:
        raise HTTPException(status_code=400, detail="扣费金额必须大于 0")

    storage_key = user_key.lower()
    user = users.get(storage_key)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.creditBalance < amount:
        raise HTTPException(
            status_code=402,
            detail=f"积分不足，本次需要 {amount} 积分，当前余额 {user.creditBalance} 积分",
        )

    user.creditBalance -= amount
    users[storage_key] = user

    transaction = create_credit_transaction(
        user,
        "debit",
        -amount,
        user.creditBalance,
        description,
        run_id=run_id,
    )
    append_credit_transaction(transactions_file, transaction)
    return transaction

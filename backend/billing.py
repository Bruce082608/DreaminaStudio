import json
import secrets
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field

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


def load_credit_transactions(transactions_file: Path) -> List[CreditTransaction]:
    transactions_file.parent.mkdir(parents=True, exist_ok=True)
    if not transactions_file.exists():
        return []

    with transactions_file.open("r", encoding="utf-8-sig") as file:
        raw_transactions = json.load(file)

    return [CreditTransaction(**item) for item in raw_transactions]


def save_credit_transactions(transactions_file: Path, transactions: List[CreditTransaction]) -> None:
    transactions_file.parent.mkdir(parents=True, exist_ok=True)
    with transactions_file.open("w", encoding="utf-8") as file:
        json.dump([jsonable_encoder(item) for item in transactions], file, ensure_ascii=False, indent=2)


def append_credit_transaction(transactions_file: Path, transaction: CreditTransaction) -> None:
    transactions = load_credit_transactions(transactions_file)
    transactions.append(transaction)
    save_credit_transactions(transactions_file, transactions)


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
        userEmail=user.email,
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
    return any(
        transaction.userEmail.lower() == user.email.lower() and transaction.type == "recharge"
        for transaction in load_credit_transactions(transactions_file)
    )


def get_user_transactions(user: Any, transactions_file: Path, limit: int = 20) -> List[CreditTransaction]:
    transactions = [
        transaction for transaction in load_credit_transactions(transactions_file)
        if transaction.userId == user.id or transaction.userEmail.lower() == user.email.lower()
    ]
    return sorted(transactions, key=lambda item: item.createdAt, reverse=True)[:limit]


def get_recharge_package(package_id: str) -> RechargePackage:
    for package in RECHARGE_PACKAGES:
        if package.id == package_id:
            return package
    raise HTTPException(status_code=400, detail="充值档位不存在")


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


def apply_recharge(users: Dict[str, Any], email: str, package_id: str, transactions_file: Path) -> CreditTransaction:
    user = users.get(email.lower())
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    package = get_recharge_package(package_id)
    if package.firstPurchaseOnly and user_has_recharged(user, transactions_file):
        raise HTTPException(status_code=400, detail="首充尝鲜包仅限首次充值")

    user.creditBalance += package.credits
    user.rechargeCount += 1
    user.lifetimeRechargeCny = round(user.lifetimeRechargeCny + package.priceCny, 2)
    users[user.email.lower()] = user

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


def apply_debit(
    users: Dict[str, Any],
    email: str,
    amount: int,
    description: str,
    transactions_file: Path,
    run_id: Optional[str] = None,
) -> CreditTransaction:
    if amount <= 0:
        raise HTTPException(status_code=400, detail="扣费金额必须大于 0")

    user = users.get(email.lower())
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.creditBalance < amount:
        raise HTTPException(
            status_code=402,
            detail=f"积分不足，本次需要 {amount} 积分，当前余额 {user.creditBalance} 积分",
        )

    user.creditBalance -= amount
    users[user.email.lower()] = user

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

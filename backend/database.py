import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

DEFAULT_DATA_DIR = Path(__file__).resolve().parent / "data"
DATABASE_URL = os.getenv(
    "DREAMINA_DATABASE_URL",
    f"sqlite:///{DEFAULT_DATA_DIR / 'dreamina_studio.sqlite3'}",
)


def get_database_path() -> Path:
    if not DATABASE_URL.startswith("sqlite:///"):
        raise RuntimeError("DREAMINA_DATABASE_URL currently supports sqlite:/// paths")
    return Path(DATABASE_URL.removeprefix("sqlite:///")).expanduser()


def connect() -> sqlite3.Connection:
    database_path = get_database_path()
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


def init_database() -> None:
    with connect() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                storage_key TEXT PRIMARY KEY,
                id TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                email TEXT NOT NULL DEFAULT '',
                phone TEXT,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                status TEXT NOT NULL DEFAULT 'active',
                credit_balance INTEGER NOT NULL DEFAULT 15,
                recharge_count INTEGER NOT NULL DEFAULT 0,
                lifetime_recharge_cny REAL NOT NULL DEFAULT 0,
                created_at REAL NOT NULL,
                last_login_at REAL,
                login_count INTEGER NOT NULL DEFAULT 0
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
                ON users(email)
                WHERE email != '';

            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique
                ON users(phone)
                WHERE phone IS NOT NULL AND phone != '';

            CREATE TABLE IF NOT EXISTS verification_codes (
                key TEXT PRIMARY KEY,
                channel TEXT NOT NULL,
                identifier TEXT NOT NULL,
                purpose TEXT NOT NULL,
                code_hash TEXT NOT NULL,
                expires_at REAL NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                created_at REAL NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_verification_codes_expires_at
                ON verification_codes(expires_at);

            CREATE TABLE IF NOT EXISTS credit_transactions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                user_email TEXT NOT NULL,
                type TEXT NOT NULL,
                amount INTEGER NOT NULL,
                balance_after INTEGER NOT NULL,
                description TEXT NOT NULL,
                created_at REAL NOT NULL,
                package_id TEXT,
                run_id TEXT,
                price_cny REAL,
                original_price_cny REAL
            );

            CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id_created_at
                ON credit_transactions(user_id, created_at DESC);

            CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_email_created_at
                ON credit_transactions(user_email, created_at DESC);

            CREATE TABLE IF NOT EXISTS recharge_requests (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                user_email TEXT NOT NULL,
                user_name TEXT NOT NULL,
                package_id TEXT NOT NULL,
                package_label TEXT NOT NULL,
                credits INTEGER NOT NULL,
                price_cny REAL NOT NULL,
                original_price_cny REAL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at REAL NOT NULL,
                handled_at REAL,
                handled_by TEXT,
                admin_note TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_recharge_requests_status_created_at
                ON recharge_requests(status, created_at DESC);

            CREATE INDEX IF NOT EXISTS idx_recharge_requests_user_id_created_at
                ON recharge_requests(user_id, created_at DESC);

            CREATE INDEX IF NOT EXISTS idx_recharge_requests_user_email_created_at
                ON recharge_requests(user_email, created_at DESC);
            """
        )


def model_to_dict(value: Any) -> Dict[str, Any]:
    if hasattr(value, "model_dump"):
        return value.model_dump()
    return dict(value)


def user_row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"] or "",
        "phone": row["phone"],
        "passwordHash": row["password_hash"],
        "role": row["role"],
        "status": row["status"],
        "creditBalance": row["credit_balance"],
        "rechargeCount": row["recharge_count"],
        "lifetimeRechargeCny": row["lifetime_recharge_cny"],
        "createdAt": row["created_at"],
        "lastLoginAt": row["last_login_at"],
        "loginCount": row["login_count"],
    }


def insert_user(
    connection: sqlite3.Connection,
    storage_key: str,
    user: Any,
    *,
    conflict: str = "REPLACE",
) -> None:
    data = model_to_dict(user)
    conflict_clause = "OR IGNORE" if conflict == "IGNORE" else "OR REPLACE"
    connection.execute(
        f"""
        INSERT {conflict_clause} INTO users (
            storage_key,
            id,
            name,
            email,
            phone,
            password_hash,
            role,
            status,
            credit_balance,
            recharge_count,
            lifetime_recharge_cny,
            created_at,
            last_login_at,
            login_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            storage_key.lower(),
            data["id"],
            data["name"],
            data.get("email") or "",
            data.get("phone"),
            data["passwordHash"],
            data.get("role") or "user",
            data.get("status") or "active",
            int(data.get("creditBalance") or 0),
            int(data.get("rechargeCount") or 0),
            float(data.get("lifetimeRechargeCny") or 0),
            float(data["createdAt"]),
            data.get("lastLoginAt"),
            int(data.get("loginCount") or 0),
        ),
    )


def load_users() -> Dict[str, Dict[str, Any]]:
    init_database()
    with connect() as connection:
        rows = connection.execute("SELECT * FROM users").fetchall()
    return {row["storage_key"]: user_row_to_dict(row) for row in rows}


def save_users(users: Dict[str, Any]) -> None:
    init_database()
    with connect() as connection:
        connection.execute("DELETE FROM users")
        for storage_key, user in users.items():
            insert_user(connection, storage_key, user)


def load_verification_codes() -> Dict[str, Dict[str, Any]]:
    init_database()
    now = time.time()
    with connect() as connection:
        connection.execute("DELETE FROM verification_codes WHERE expires_at <= ?", (now,))
        rows = connection.execute("SELECT * FROM verification_codes").fetchall()
    return {
        row["key"]: {
            "channel": row["channel"],
            "identifier": row["identifier"],
            "purpose": row["purpose"],
            "codeHash": row["code_hash"],
            "expiresAt": row["expires_at"],
            "attempts": row["attempts"],
            "createdAt": row["created_at"],
        }
        for row in rows
    }


def save_verification_codes(codes: Dict[str, Dict[str, Any]]) -> None:
    init_database()
    with connect() as connection:
        connection.execute("DELETE FROM verification_codes")
        connection.executemany(
            """
            INSERT OR REPLACE INTO verification_codes (
                key,
                channel,
                identifier,
                purpose,
                code_hash,
                expires_at,
                attempts,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    key,
                    value["channel"],
                    value["identifier"],
                    value["purpose"],
                    value["codeHash"],
                    float(value["expiresAt"]),
                    int(value.get("attempts") or 0),
                    float(value.get("createdAt") or time.time()),
                )
                for key, value in codes.items()
            ],
        )


def transaction_row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "userEmail": row["user_email"],
        "type": row["type"],
        "amount": row["amount"],
        "balanceAfter": row["balance_after"],
        "description": row["description"],
        "createdAt": row["created_at"],
        "packageId": row["package_id"],
        "runId": row["run_id"],
        "priceCny": row["price_cny"],
        "originalPriceCny": row["original_price_cny"],
    }


def insert_credit_transaction(
    connection: sqlite3.Connection,
    transaction: Any,
    *,
    conflict: str = "REPLACE",
) -> None:
    data = model_to_dict(transaction)
    conflict_clause = "OR IGNORE" if conflict == "IGNORE" else "OR REPLACE"
    connection.execute(
        f"""
        INSERT {conflict_clause} INTO credit_transactions (
            id,
            user_id,
            user_email,
            type,
            amount,
            balance_after,
            description,
            created_at,
            package_id,
            run_id,
            price_cny,
            original_price_cny
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            data["id"],
            data["userId"],
            data["userEmail"],
            data["type"],
            int(data["amount"]),
            int(data["balanceAfter"]),
            data["description"],
            float(data["createdAt"]),
            data.get("packageId"),
            data.get("runId"),
            data.get("priceCny"),
            data.get("originalPriceCny"),
        ),
    )


def load_credit_transactions() -> List[Dict[str, Any]]:
    init_database()
    with connect() as connection:
        rows = connection.execute(
            "SELECT * FROM credit_transactions ORDER BY created_at ASC"
        ).fetchall()
    return [transaction_row_to_dict(row) for row in rows]


def save_credit_transactions(transactions: Iterable[Any]) -> None:
    init_database()
    with connect() as connection:
        connection.execute("DELETE FROM credit_transactions")
        for transaction in transactions:
            insert_credit_transaction(connection, transaction)


def append_credit_transaction(transaction: Any) -> None:
    init_database()
    with connect() as connection:
        insert_credit_transaction(connection, transaction)


def recharge_request_row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "userEmail": row["user_email"],
        "userName": row["user_name"],
        "packageId": row["package_id"],
        "packageLabel": row["package_label"],
        "credits": row["credits"],
        "priceCny": row["price_cny"],
        "originalPriceCny": row["original_price_cny"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "handledAt": row["handled_at"],
        "handledBy": row["handled_by"],
        "adminNote": row["admin_note"],
    }


def insert_recharge_request(
    connection: sqlite3.Connection,
    recharge_request: Any,
    *,
    conflict: str = "REPLACE",
) -> None:
    data = model_to_dict(recharge_request)
    conflict_clause = "OR IGNORE" if conflict == "IGNORE" else "OR REPLACE"
    connection.execute(
        f"""
        INSERT {conflict_clause} INTO recharge_requests (
            id,
            user_id,
            user_email,
            user_name,
            package_id,
            package_label,
            credits,
            price_cny,
            original_price_cny,
            status,
            created_at,
            handled_at,
            handled_by,
            admin_note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            data["id"],
            data["userId"],
            data["userEmail"],
            data["userName"],
            data["packageId"],
            data["packageLabel"],
            int(data["credits"]),
            float(data["priceCny"]),
            data.get("originalPriceCny"),
            data.get("status") or "pending",
            float(data["createdAt"]),
            data.get("handledAt"),
            data.get("handledBy"),
            data.get("adminNote"),
        ),
    )


def create_recharge_request(recharge_request: Any) -> Dict[str, Any]:
    init_database()
    with connect() as connection:
        insert_recharge_request(connection, recharge_request)
    created = get_recharge_request(model_to_dict(recharge_request)["id"])
    if not created:
        raise RuntimeError("Failed to create recharge request")
    return created


def get_recharge_request(request_id: str) -> Optional[Dict[str, Any]]:
    init_database()
    with connect() as connection:
        row = connection.execute(
            "SELECT * FROM recharge_requests WHERE id = ?",
            (request_id,),
        ).fetchone()
    return recharge_request_row_to_dict(row) if row else None


def load_recharge_requests(
    *,
    status: Optional[str] = None,
    user_id: Optional[str] = None,
    user_email: Optional[str] = None,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    init_database()
    clauses: List[str] = []
    params: List[Any] = []
    if status:
        clauses.append("status = ?")
        params.append(status)
    if user_id:
        clauses.append("user_id = ?")
        params.append(user_id)
    if user_email:
        clauses.append("LOWER(user_email) = ?")
        params.append(user_email.lower())

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    safe_limit = max(1, min(int(limit), 500))
    with connect() as connection:
        rows = connection.execute(
            f"""
            SELECT * FROM recharge_requests
            {where}
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (*params, safe_limit),
        ).fetchall()
    return [recharge_request_row_to_dict(row) for row in rows]


def update_recharge_request(request_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    allowed_columns = {
        "status": "status",
        "handledAt": "handled_at",
        "handledBy": "handled_by",
        "adminNote": "admin_note",
    }
    assignments: List[str] = []
    params: List[Any] = []
    for key, value in updates.items():
        column = allowed_columns.get(key)
        if not column:
            continue
        assignments.append(f"{column} = ?")
        params.append(value)
    if not assignments:
        return get_recharge_request(request_id)

    init_database()
    with connect() as connection:
        connection.execute(
            f"UPDATE recharge_requests SET {', '.join(assignments)} WHERE id = ?",
            (*params, request_id),
        )
    return get_recharge_request(request_id)


def read_json_file(path: Path) -> Optional[Any]:
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8-sig") as file:
        return json.load(file)


def migrate_json_files(
    users_file: Path,
    transactions_file: Path,
    verification_codes_file: Path,
) -> None:
    init_database()
    now = time.time()

    with connect() as connection:
        raw_users = read_json_file(users_file) or {}
        for storage_key, user in raw_users.items():
            insert_user(connection, storage_key, user, conflict="IGNORE")

        raw_transactions = read_json_file(transactions_file) or []
        for transaction in raw_transactions:
            insert_credit_transaction(connection, transaction, conflict="IGNORE")

        raw_codes = read_json_file(verification_codes_file) or {}
        for key, value in raw_codes.items():
            if float(value.get("expiresAt", 0)) <= now:
                continue
            connection.execute(
                """
                INSERT OR REPLACE INTO verification_codes (
                    key,
                    channel,
                    identifier,
                    purpose,
                    code_hash,
                    expires_at,
                    attempts,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    key,
                    value["channel"],
                    value["identifier"],
                    value["purpose"],
                    value["codeHash"],
                    float(value["expiresAt"]),
                    int(value.get("attempts") or 0),
                    float(value.get("createdAt") or now),
                ),
            )


def public_status() -> Dict[str, Any]:
    database_path = get_database_path()
    init_database()
    with connect() as connection:
        user_count = connection.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        transaction_count = connection.execute("SELECT COUNT(*) FROM credit_transactions").fetchone()[0]
        recharge_request_count = connection.execute("SELECT COUNT(*) FROM recharge_requests").fetchone()[0]
    return {
        "engine": "sqlite",
        "path": str(database_path),
        "exists": database_path.exists(),
        "userCount": user_count,
        "transactionCount": transaction_count,
        "rechargeRequestCount": recharge_request_count,
    }

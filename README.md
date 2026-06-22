# Dreamina Studio

Dreamina Studio is a React + FastAPI long-video creation console. The backend handles user auth, credits, storyboard planning, and Jimeng CLI video generation.

## Local Development

Start the backend:

```bash
python3 -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Start the frontend:

```bash
npm run dev -- --host 127.0.0.1 --port 5174
```

Open:

```text
http://127.0.0.1:5174
```

## Database

The backend uses SQLite by default:

```text
backend/data/dreamina_studio.sqlite3
```

You can override the database location:

```bash
export DREAMINA_DATABASE_URL="sqlite:////absolute/path/dreamina_studio.sqlite3"
```

On startup, the backend initializes the database and migrates existing JSON data from:

```text
backend/data/users.json
backend/data/credit_transactions.json
backend/data/verification_codes.json
```

The JSON files are now legacy migration inputs. New user accounts, verification codes, and credit transactions are written to SQLite.

## Default Admin

```text
admin@dreamina.local
Dreamina@2026
```

Override with:

```bash
export DREAMINA_ADMIN_EMAIL="admin@example.com"
export DREAMINA_ADMIN_PASSWORD="change-me"
```

## Verification Codes

Registration uses email verification only. The default SMTP provider is QQ Mail:

```bash
export DREAMINA_SMTP_HOST="smtp.qq.com"
export DREAMINA_SMTP_PORT="465"
export DREAMINA_SMTP_USERNAME="873831183@qq.com"
export DREAMINA_SMTP_PASSWORD="your-qq-mail-smtp-authorization-code"
export DREAMINA_SMTP_FROM="873831183@qq.com"
export DREAMINA_SMTP_TLS="false"
export DREAMINA_SMTP_SSL="true"
```

`DREAMINA_SMTP_PASSWORD` must be the QQ Mail SMTP authorization code, not the QQ login password. Local development defaults to verification dev mode, so the code is returned to the frontend for testing. In production, keep `DREAMINA_VERIFICATION_DEV_MODE=false`.

## Checks

```bash
python3 -m py_compile backend/main.py backend/billing.py backend/database.py backend/test_agent_flow.py
python3 -m unittest backend.test_agent_flow
npm run lint
npm run build
```

## Persistent Server Deployment

Run this on the server from the repository root:

```bash
bash setup_server.sh
```

Or upload from your local machine and deploy remotely:

```bash
./deploy_server.sh 43.129.24.162
```

With an SSH key:

```bash
SSH_KEY=/path/to/key.pem ./deploy_server.sh 43.129.24.162
```

The script will:

- Build the frontend and publish it to `/var/www/dreamina_studio`
- Configure Nginx from `dreamina_studio.conf`
- Build and start the backend Docker container
- Bind the backend only on `127.0.0.1:8000`
- Persist backend data at `/var/lib/dreamina_studio/backend-data`
- Persist Jimeng CLI login/cache at `/var/lib/dreamina_studio/cli-home`
- Install `/usr/local/bin/dreamina-studio-backup`

Production backend environment:

```text
/var/www/dreamina_studio_backend/.env
```

Important values to edit after first deployment:

```bash
DREAMINA_AUTH_SECRET=...
DEEPSEEK_API_KEY=...
DREAMINA_VERIFICATION_DEV_MODE=false
DREAMINA_SMTP_HOST=smtp.qq.com
DREAMINA_SMTP_PORT=465
DREAMINA_SMTP_USERNAME=873831183@qq.com
DREAMINA_SMTP_PASSWORD=...
DREAMINA_SMTP_FROM=873831183@qq.com
DREAMINA_SMTP_TLS=false
DREAMINA_SMTP_SSL=true
```

After editing the backend environment on an already configured server, restart the backend container:

```bash
cd /var/www/dreamina_studio_backend
docker compose up -d --build
docker logs -f dreamina_backend
```

Database and generated files:

```text
/var/lib/dreamina_studio/backend-data/dreamina_studio.sqlite3
/var/lib/dreamina_studio/backend-data/uploads
/var/lib/dreamina_studio/backend-data/outputs
```

Back up persistent data:

```bash
dreamina-studio-backup
```

After deploying the Docker backend, log in to the official Jimeng CLI inside the container if needed:

```bash
docker exec -it dreamina_backend dreamina login
```

Because `/root` is mounted to `/var/lib/dreamina_studio/cli-home`, the CLI login state survives container rebuilds.

## Jimeng CLI Account Pool

By default the backend uses the single CLI login state mounted at `/root`. For higher throughput, configure multiple independent Jimeng CLI accounts in the backend `.env`:

```bash
DREAMINA_CLI_ACCOUNTS='[
  {"id":"vip-1","alias":"高级号1","home":"/app/data/cli-accounts/vip-1","maxConcurrent":1},
  {"id":"vip-2","alias":"高级号2","home":"/app/data/cli-accounts/vip-2","maxConcurrent":1}
]'
```

Each `home` path stores one account's OAuth login/cache. The backend scheduler leases one available account slot per video task and uses a local FIFO queue so users see their queue position when all slots are busy. By default it does not treat old `dreamina list_task` `querying` entries as hard locks, because stale upstream tasks can otherwise block the whole site forever. If the official CLI returns `ExceedConcurrencyLimit`, the account is temporarily marked as remotely busy and the waiting task is put back into the pool queue.

Keep `maxConcurrent` at `1` for models that do not support same-account parallel submit. Raise it only for accounts/models you have verified can submit concurrently; the backend will still back off if Dreamina rejects a submit with an upstream concurrency limit.

Optional tuning:

```bash
# Single-login default in docker-compose is 2 so verified VIP models can overlap.
DREAMINA_CLI_ACCOUNT_MAX_CONCURRENT=2

# Only these models may use same-account parallel submit slots by default.
DREAMINA_CLI_PARALLEL_MODELS=seedance2.0_vip,seedance2.0fast_vip

# Re-enable the old pre-submit list_task active-task gate when you know upstream statuses are reliable.
DREAMINA_CLI_CHECK_REMOTE_ACTIVE_TASKS=true

# How long to wait before retrying after Dreamina returns ExceedConcurrencyLimit.
DREAMINA_CLI_REMOTE_BUSY_RETRY_SECONDS=45

# Fail and refund a submitted task that stays at querying with no queue info or files.
DREAMINA_CLI_STALE_QUERYING_TIMEOUT_SECONDS=900
```

Log in each account separately:

```bash
docker exec -it -e HOME=/app/data/cli-accounts/vip-1 dreamina_backend dreamina login
docker exec -it -e HOME=/app/data/cli-accounts/vip-2 dreamina_backend dreamina login
```

Check pool status from the admin API or inside the container:

```bash
docker exec -it -e HOME=/app/data/cli-accounts/vip-1 dreamina_backend dreamina user_credit
docker exec -it -e HOME=/app/data/cli-accounts/vip-2 dreamina_backend dreamina user_credit
```

## Agent Concurrency Controls

Creative runs now enter a site-level Agent job queue before calling DeepSeek or Jimeng. The queue prevents public traffic spikes from creating unlimited long-running backend tasks, while async workers keep the Jimeng account pool busy.

Tune these values in the backend `.env`:

```bash
DREAMINA_AGENT_WORKERS=4
DREAMINA_AGENT_MAX_QUEUE_SIZE=200
DREAMINA_USER_ACTIVE_RUN_LIMIT=2
DREAMINA_USER_QUEUED_RUN_LIMIT=20
DREAMINA_AGENT_REQUEUE_DELAY_SECONDS=0.5
```

Suggested starting point:

- Set `DREAMINA_AGENT_WORKERS` close to the total Jimeng account pool capacity, for example 8 accounts x `maxConcurrent=1` = 8 workers.
- Keep each Jimeng account `maxConcurrent=1` unless Jimeng explicitly allows more concurrent generations for that account.
- Increase `DREAMINA_AGENT_MAX_QUEUE_SIZE` only when the server has enough CPU, memory, disk, and operator visibility to handle the backlog.
- Use `DREAMINA_USER_ACTIVE_RUN_LIMIT` and `DREAMINA_USER_QUEUED_RUN_LIMIT` to stop one customer from filling the queue during traffic spikes.

Current limits are in-process. For multiple backend containers or Uvicorn workers, move Agent jobs and run state to Redis/Postgres-backed infrastructure before scaling horizontally.

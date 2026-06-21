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

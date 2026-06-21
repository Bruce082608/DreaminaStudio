#!/usr/bin/env bash
# Dreamina Studio - persistent server deployment script.
# Target OS: OpenCloudOS 8 / CentOS 8 / RHEL 8 compatible.
# Run from the repository root as root: bash setup_server.sh

set -euo pipefail

APP_NAME="dreamina_studio"
FRONTEND_DIR="${FRONTEND_DIR:-/var/www/dreamina_studio}"
BACKEND_DIR="${BACKEND_DIR:-/var/www/dreamina_studio_backend}"
DATA_DIR="${DREAMINA_DATA_DIR:-/var/lib/dreamina_studio/backend-data}"
CLI_HOME_DIR="${DREAMINA_CLI_HOME_DIR:-/var/lib/dreamina_studio/cli-home}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/dreamina_studio}"
NGINX_CONF="${NGINX_CONF:-/etc/nginx/conf.d/dreamina_studio.conf}"

log() {
  printf "\n==> %s\n" "$1"
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Please run this script as root." >&2
    exit 1
  fi
}

install_package() {
  local package_name="$1"
  if command -v dnf >/dev/null 2>&1; then
    dnf install -y "$package_name"
  else
    yum install -y "$package_name"
  fi
}

ensure_command() {
  local command_name="$1"
  local package_name="${2:-$1}"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    log "Installing $package_name"
    install_package "$package_name"
  fi
}

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
  else
    echo ""
  fi
}

ensure_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    log "Installing Docker"
    install_package docker
  fi

  systemctl enable docker
  systemctl start docker

  if [ -z "$(compose_cmd)" ]; then
    echo "Docker Compose was not found. Install the Docker Compose plugin, then rerun this script." >&2
    exit 1
  fi
}

build_frontend() {
  if [ -f dist/index.html ] && [ "${FORCE_FRONTEND_BUILD:-0}" != "1" ]; then
    log "Using prebuilt frontend dist"
    return
  fi

  ensure_command npm npm

  if [ ! -d node_modules ]; then
    log "Installing frontend dependencies"
    npm ci
  fi

  log "Building frontend"
  npm run build

  if [ ! -f dist/index.html ]; then
    echo "Frontend build failed: dist/index.html was not created." >&2
    exit 1
  fi
}

deploy_frontend() {
  log "Publishing frontend to $FRONTEND_DIR"
  mkdir -p "$FRONTEND_DIR"
  rm -rf "$FRONTEND_DIR"/*
  cp -a dist/. "$FRONTEND_DIR"/
  chown -R root:root "$FRONTEND_DIR"
  find "$FRONTEND_DIR" -type d -exec chmod 755 {} \;
  find "$FRONTEND_DIR" -type f -exec chmod 644 {} \;
}

configure_nginx() {
  log "Configuring Nginx"
  ensure_command nginx nginx
  systemctl enable nginx
  systemctl start nginx
  cp dreamina_studio.conf "$NGINX_CONF"
  nginx -t
  systemctl reload nginx || systemctl restart nginx
}

prepare_persistent_dirs() {
  log "Preparing persistent data directories"
  mkdir -p "$DATA_DIR" "$CLI_HOME_DIR" "$BACKUP_DIR"
  chmod 700 "$CLI_HOME_DIR"

  for legacy_file in users.json credit_transactions.json verification_codes.json; do
    if [ -f "backend/data/$legacy_file" ] && [ ! -f "$DATA_DIR/$legacy_file" ]; then
      cp "backend/data/$legacy_file" "$DATA_DIR/$legacy_file"
    fi
  done
}

deploy_backend_source() {
  log "Publishing backend source to $BACKEND_DIR"
  local preserved_env=""
  if [ -f "$BACKEND_DIR/.env" ]; then
    preserved_env="$(mktemp)"
    cp "$BACKEND_DIR/.env" "$preserved_env"
  fi

  rm -rf "$BACKEND_DIR"
  mkdir -p "$BACKEND_DIR"
  cp -a backend/. "$BACKEND_DIR"/
  rm -rf "$BACKEND_DIR/data"

  if [ -n "$preserved_env" ]; then
    mv "$preserved_env" "$BACKEND_DIR/.env"
  fi
}

ensure_backend_env() {
  log "Preparing backend environment"
  cd "$BACKEND_DIR"

  ensure_env_value() {
    local key="$1"
    local value="$2"
    if grep -q "^$key=" .env; then
      if grep -Eq "^$key=(\"\")?$" .env; then
        sed -i "s|^$key=.*|$key=$value|" .env
      fi
    else
      printf "%s=%s\n" "$key" "$value" >> .env
    fi
  }

  if [ ! -f .env ]; then
    cp .env.example .env
    local auth_secret
    if command -v openssl >/dev/null 2>&1; then
      auth_secret="$(openssl rand -hex 32)"
    else
      auth_secret="$(date +%s%N | sha256sum | awk '{print $1}')"
    fi
    sed -i "s/change-this-to-a-long-random-secret/$auth_secret/" .env
  fi

  sed -i "s|^DREAMINA_DATA_DIR=.*|DREAMINA_DATA_DIR=$DATA_DIR|" .env
  sed -i "s|^DREAMINA_CLI_HOME_DIR=.*|DREAMINA_CLI_HOME_DIR=$CLI_HOME_DIR|" .env
  sed -i "s|^DREAMINA_DATABASE_URL=.*|DREAMINA_DATABASE_URL=sqlite:////app/data/dreamina_studio.sqlite3|" .env

  ensure_env_value DREAMINA_VERIFICATION_RESEND_COOLDOWN_SECONDS 60
  ensure_env_value DREAMINA_SMTP_HOST smtp.qq.com
  ensure_env_value DREAMINA_SMTP_PORT 465
  ensure_env_value DREAMINA_SMTP_USERNAME 873831183@qq.com
  ensure_env_value DREAMINA_SMTP_PASSWORD ""
  ensure_env_value DREAMINA_SMTP_FROM 873831183@qq.com
  ensure_env_value DREAMINA_SMTP_TLS false
  ensure_env_value DREAMINA_SMTP_SSL true
}

create_backup_script() {
  log "Installing backup helper"
  cat >/usr/local/bin/dreamina-studio-backup <<EOF
#!/usr/bin/env bash
set -euo pipefail
timestamp="\$(date +%Y%m%d%H%M%S)"
backup_file="$BACKUP_DIR/dreamina_studio_\$timestamp.tgz"
mkdir -p "$BACKUP_DIR"
tar -czf "\$backup_file" -C /var/lib dreamina_studio
find "$BACKUP_DIR" -type f -name 'dreamina_studio_*.tgz' -mtime +14 -delete
echo "Created \$backup_file"
EOF
  chmod 755 /usr/local/bin/dreamina-studio-backup
}

stop_legacy_backend() {
  log "Stopping legacy host backend if present"
  pkill -f "uvicorn .*backend.main:app" >/dev/null 2>&1 || true
  pkill -f "uvicorn .*main:app" >/dev/null 2>&1 || true
}

start_backend() {
  log "Building and starting backend container"
  cd "$BACKEND_DIR"
  local compose
  compose="$(compose_cmd)"
  $compose up -d --build
}

verify_deployment() {
  log "Verifying deployment"
  local attempt
  for attempt in $(seq 1 20); do
    if curl -fsS http://127.0.0.1:8000/health >/tmp/dreamina_backend_health.json; then
      break
    fi
    if [ "$attempt" -eq 20 ]; then
      echo "Backend health check did not become ready in time." >&2
      return 1
    fi
    sleep 2
  done
  python3 - <<'PY'
import json
from pathlib import Path

payload = json.loads(Path("/tmp/dreamina_backend_health.json").read_text(encoding="utf-8"))
database = payload.get("database")
if payload.get("status") != "healthy" or not database or database.get("engine") != "sqlite":
    raise SystemExit(f"Backend is reachable but not the persistent database build: {payload}")
PY
  curl -fsS -H "Host: dreaminastudio.xyz" http://127.0.0.1/ >/dev/null
  echo "Backend health:"
  cat /tmp/dreamina_backend_health.json
  echo
}

main() {
  require_root
  ensure_command curl curl
  ensure_docker
  build_frontend
  deploy_frontend
  configure_nginx
  prepare_persistent_dirs
  deploy_backend_source
  ensure_backend_env
  create_backup_script
  stop_legacy_backend
  start_backend
  verify_deployment

  log "Deployment completed"
  echo "Frontend: http://dreaminastudio.xyz/"
  echo "API:      http://dreaminastudio.xyz/api/health"
  echo "Data:     $DATA_DIR"
  echo "CLI home: $CLI_HOME_DIR"
  echo "Backup:   run dreamina-studio-backup"
}

main "$@"

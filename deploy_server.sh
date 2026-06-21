#!/usr/bin/env bash
# Upload this repository to a server and run the persistent deployment script.
# Usage:
#   ./deploy_server.sh 43.129.24.162
# Optional:
#   SSH_USER=root SSH_KEY=/path/to/key.pem ./deploy_server.sh 43.129.24.162

set -euo pipefail

SERVER_IP="${1:-43.129.24.162}"
SSH_USER="${SSH_USER:-root}"
REMOTE_DIR="${REMOTE_DIR:-/opt/dreamina_studio_source}"
TIMESTAMP="$(date +%Y%m%d%H%M%S)"
ARCHIVE_NAME="dreamina_studio_source_${TIMESTAMP}.tgz"
ARCHIVE_PATH="/tmp/${ARCHIVE_NAME}"
REMOTE_ARCHIVE="/tmp/${ARCHIVE_NAME}"

SSH_OPTIONS=(
  -o StrictHostKeyChecking=no
  -o ConnectTimeout=15
)

if [ "${SSH_KEY:-}" != "" ]; then
  SSH_OPTIONS+=(-i "$SSH_KEY")
fi

TARGET="${SSH_USER}@${SERVER_IP}"

cleanup() {
  rm -f "$ARCHIVE_PATH"
}
trap cleanup EXIT

echo "Building source archive..."
npm run build

tar \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude "backend/data" \
  --exclude "dreamina_studio_deploy.zip" \
  --exclude "*.tgz" \
  -czf "$ARCHIVE_PATH" \
  .

echo "Preparing remote directory..."
ssh "${SSH_OPTIONS[@]}" "$TARGET" "mkdir -p '$REMOTE_DIR'"

echo "Uploading archive to $TARGET..."
scp "${SSH_OPTIONS[@]}" "$ARCHIVE_PATH" "${TARGET}:${REMOTE_ARCHIVE}"

echo "Extracting and deploying on server..."
ssh "${SSH_OPTIONS[@]}" "$TARGET" "
set -euo pipefail
rm -rf '$REMOTE_DIR'/*
tar -xzf '$REMOTE_ARCHIVE' -C '$REMOTE_DIR'
rm -f '$REMOTE_ARCHIVE'
cd '$REMOTE_DIR'
bash setup_server.sh
"

echo "Deployment finished."
echo "Site: http://dreaminastudio.xyz/"
echo "API:  http://dreaminastudio.xyz/api/health"

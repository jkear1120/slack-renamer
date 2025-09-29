#!/bin/zsh
set -euo pipefail

ROOT="$(cd -- "$(dirname "$0")/.." && pwd)"
DIST_DIR="${ROOT}/dist"
APP_NAME="SlackRenamer.app"
SRC_APP_DIR="${ROOT}/mac/SlackRenamer.app"
OUT_APP_DIR="${DIST_DIR}/${APP_NAME}"

echo "== Packaging ${APP_NAME} =="
rm -rf "${OUT_APP_DIR}"
mkdir -p "${DIST_DIR}"

# Copy base bundle
rsync -a "${SRC_APP_DIR}/" "${OUT_APP_DIR}/"

# Prepare app source inside bundle
APP_RES="${OUT_APP_DIR}/Contents/Resources"
APP_APP="${APP_RES}/app"
mkdir -p "${APP_APP}"

echo "Copying app files..."
rsync -a --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude "dist" \
  --exclude "logs" \
  --exclude "mac/SlackRenamer.app" \
  "${ROOT}/public" "${ROOT}/src" "${ROOT}/package.json" "${ROOT}/package-lock.json" "${APP_APP}/"

echo "Installing production dependencies inside bundle..."
(
  cd "${APP_APP}"
  npm ci --omit=dev || npm install --omit=dev
)

echo "Embedding Node runtime..."
NODE_BIN="$(command -v node || true)"
if [ -z "${NODE_BIN}" ]; then
  echo "[エラー] Node.js が見つかりません。Node 18+ をインストールしてください。"
  exit 1
fi
cp "${NODE_BIN}" "${OUT_APP_DIR}/Contents/MacOS/node"
chmod +x "${OUT_APP_DIR}/Contents/MacOS/node"

echo "Icon check..."
if [ ! -f "${OUT_APP_DIR}/Contents/Resources/AppIcon.icns" ]; then
  echo "Generating icon (placeholder if no mac/icon-source.png)"
  "${ROOT}/mac/make-app-icon.command" || true
  # copy generated icon if script created it under src app
  if [ -f "${ROOT}/mac/SlackRenamer.app/Contents/Resources/AppIcon.icns" ]; then
    cp "${ROOT}/mac/SlackRenamer.app/Contents/Resources/AppIcon.icns" "${OUT_APP_DIR}/Contents/Resources/AppIcon.icns"
  fi
fi

echo "Done: ${OUT_APP_DIR}"
open -R "${OUT_APP_DIR}"


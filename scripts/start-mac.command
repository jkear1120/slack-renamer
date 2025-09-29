#!/bin/zsh
set -euo pipefail

# Resolve project root (this script is expected under scripts/)
SCRIPT_DIR="$(cd -- "$(dirname "$0")" >/dev/null 2>&1 && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

echo "== Slack Renamer 起動 =="

# Check Node
if ! command -v node >/dev/null 2>&1; then
  echo "[エラー] Node.js が見つかりません。Node 18+ をインストールしてください。"
  read -r _?"Enter で閉じます…"
  exit 1
fi

# Install deps if needed
if [ ! -d node_modules ]; then
  echo "依存関係をインストールします…"
  npm install || { echo "npm install に失敗しました"; read -r _?"Enter で閉じます…"; exit 1; }
fi

# Tokens (prompt only if not already set in env)
if [ -z "${SLACK_USER_TOKEN:-}" ]; then
  echo -n "SLACK_USER_TOKEN を入力（必須、入力は表示されません）: "
  read -rs SLACK_USER_TOKEN
  echo
fi

if [ -z "${SLACK_ADMIN_TOKEN:-}" ]; then
  echo -n "SLACK_ADMIN_TOKEN を入力（任意、未入力でスキップ）: "
  read -rs SLACK_ADMIN_TOKEN || true
  echo
fi

export SLACK_USER_TOKEN
export SLACK_ADMIN_TOKEN

# Port (optional)
PORT="${PORT:-3000}"
export PORT

echo "サーバを起動します: http://localhost:${PORT}"
open "http://localhost:${PORT}" 2>/dev/null || true

npm start


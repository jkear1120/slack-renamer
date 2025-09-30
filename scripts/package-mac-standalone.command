#!/bin/zsh
set -euo pipefail

ROOT="$(cd -- "$(dirname "$0")/.." && pwd)"
DIST_DIR="${ROOT}/dist"
APP_NAME="SlackRenamer.app"
OUT_APP_DIR="${DIST_DIR}/${APP_NAME}"
APP_CNT="${OUT_APP_DIR}/Contents"
APP_RES="${APP_CNT}/Resources"
APP_MAC="${APP_CNT}/MacOS"
APP_APP_DIR="${APP_RES}/app"

echo "== Build standalone ${APP_NAME} =="
rm -rf "${OUT_APP_DIR}"
mkdir -p "${APP_RES}" "${APP_MAC}" "${APP_APP_DIR}"

# Write Info.plist
cat > "${APP_CNT}/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>SlackRenamer</string>
  <key>CFBundleIdentifier</key>
  <string>com.local.slackrenamer</string>
  <key>CFBundleExecutable</key>
  <string>SlackRenamer</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleVersion</key>
  <string>0.1.0</string>
  <key>LSMinimumSystemVersion</key>
  <string>10.13</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
</dict>
</plist>
PLIST

# Icon: generate from mac/icon-source.png if present, else create placeholder
ICNS="${APP_RES}/AppIcon.icns"
ICON_SRC="${ROOT}/mac/icon-source.png"
if ! command -v iconutil >/dev/null 2>&1; then
  echo "[warn] iconutil が無いためアイコン生成をスキップします（デフォルトアイコン使用）"
else
  TMPICON=$(mktemp -d)
  ICONSET="${TMPICON}/AppIcon.iconset"
  mkdir -p "${ICONSET}"
  if [ ! -f "${ICON_SRC}" ]; then
    echo "[info] mac/icon-source.png が無いのでプレースホルダーを生成します"
    # 1x1白PNG base64 → 拡大
    PLACE="${TMPICON}/base.png"
    /bin/echo 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YQbf0wAAAAASUVORK5CYII=' | /usr/bin/base64 -D -o "${PLACE}" 2>/dev/null || /usr/bin/base64 --decode > "${PLACE}" <<<'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YQbf0wAAAAASUVORK5CYII='
    ICON_SRC="${PLACE}"
  fi
  for sz in 16 32 128 256 512; do
    sips -z $sz $sz     "${ICON_SRC}" --out "${ICONSET}/icon_${sz}x${sz}.png" >/dev/null
    sips -z $((sz*2)) $((sz*2)) "${ICON_SRC}" --out "${ICONSET}/icon_${sz}x${sz}@2x.png" >/dev/null
  done
  # 1024 (512@2x)
  sips -z 1024 1024 "${ICON_SRC}" --out "${ICONSET}/icon_512x512@2x.png" >/dev/null
  iconutil -c icns "${ICONSET}" -o "${ICNS}" || echo "[warn] icns生成に失敗（デフォルトアイコン使用）"
  rm -rf "${TMPICON}"
fi

echo "Copy app sources..."
rsync -a --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude "dist" \
  --exclude "logs" \
  "${ROOT}/public" "${ROOT}/src" "${ROOT}/package.json" "${ROOT}/package-lock.json" "${APP_APP_DIR}/"

echo "Install production dependencies..."
(
  cd "${APP_APP_DIR}"
  npm ci --omit=dev || npm install --omit=dev
)

echo "Embed Node runtime..."
NODE_BIN="$(command -v node || true)"
if [ -z "${NODE_BIN}" ]; then
  echo "[エラー] Node.js が見つかりません。Node 18+ をインストールしてください。"
  exit 1
fi
cp "${NODE_BIN}" "${APP_MAC}/node"
chmod +x "${APP_MAC}/node"

echo "Write launcher..."
cat > "${APP_MAC}/SlackRenamer" <<'LAUNCH'
#!/bin/zsh
set -euo pipefail
APP_MAC="$(cd -- "$(dirname "$0")" && pwd)"
APP_RES="${APP_MAC}/../Resources"
APP_DIR="${APP_RES}/app"
NODE_BIN="${APP_MAC}/node"
export SLACK_RENAMER_TOKENS_FILE="${HOME}/Library/Application Support/SlackRenamer/tokens.json"
PORT="${PORT:-3000}"
open "http://localhost:${PORT}" 2>/dev/null || true
cd "${APP_DIR}"
exec "${NODE_BIN}" src/server.js
LAUNCH
chmod +x "${APP_MAC}/SlackRenamer"

echo "Done: ${OUT_APP_DIR}"
open -R "${OUT_APP_DIR}" 2>/dev/null || true


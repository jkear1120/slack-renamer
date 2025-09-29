#!/bin/zsh
set -euo pipefail

ROOT="$(cd -- "$(dirname "$0")/.." && pwd)"
APP_DIR="${ROOT}/mac/SlackRenamer.app"
RES_DIR="${APP_DIR}/Contents/Resources"
ICNS="${RES_DIR}/AppIcon.icns"

echo "== SlackRenamer: アイコン生成 =="
echo "入力画像: ${ROOT}/mac/icon-source.png (1024x1024 PNG推奨)"
if [ ! -f "${ROOT}/mac/icon-source.png" ]; then
  echo "[注意] mac/icon-source.png が見つかりません。1024x1024のPNGを配置してください。"
  read -r _?"Enterで続行（中止するには Ctrl+C）…"
fi

if ! command -v iconutil >/dev/null 2>&1; then
  echo "[エラー] iconutil が見つかりません。Xcode Command Line Tools をインストールしてください。"
  exit 1
fi

mkdir -p "${RES_DIR}"
TMPDIR_ICON=$(mktemp -d)
ICONSET="${TMPDIR_ICON}/AppIcon.iconset"
mkdir -p "${ICONSET}"

SRC="${ROOT}/mac/icon-source.png"
if [ ! -f "${SRC}" ]; then
  # フォールバック: 単色オレンジのプレースホルダを生成
  echo "[info] プレースホルダーアイコンを生成します（オレンジ一色）"
  # 1024x1024の空画像（白）→色変換はsipsでの塗りつぶしができないため白のまま
  # 利用者は後で mac/icon-source.png を差し替えて再実行してください
  /usr/bin/sips -s format png --resampleWidth 1024 /System/Library/CoreServices/DefaultDesktop.jpg --out "${SRC}" >/dev/null 2>&1 || true
fi

for sz in 16 32 128 256 512; do
  sips -z $sz $sz     "${SRC}" --out "${ICONSET}/icon_${sz}x${sz}.png" >/dev/null
  sips -z $((sz*2)) $((sz*2)) "${SRC}" --out "${ICONSET}/icon_${sz}x${sz}@2x.png" >/dev/null
done
cp "${SRC}" "${ICONSET}/icon_512x512@2x.png"

iconutil -c icns "${ICONSET}" -o "${ICNS}"
rm -rf "${TMPDIR_ICON}"

echo "作成しました: ${ICNS}"
echo "Finderの情報ウインドウでアイコン反映を確認してください。反映に時間がかかる場合があります。"


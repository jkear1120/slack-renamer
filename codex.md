# CODEX: Slack Channel CSV Renamer 技術仕様

本書は開発者／運用担当者向けに、現行実装（ブラウザUI+Express API）の構成・API・セキュリティ・拡張方針をまとめたものです。

---

## アーキテクチャ

- Webアプリ（ローカル実行）
  - フロント: 静的HTML（`public/index.html`）
  - バックエンド: Express（`src/server.js`）
- Slack Web API: `conversations.list`, `conversations.rename`, `admin.conversations.rename`
- I/O（CSV）
  - エクスポート: `channel_id,current_name,channel_type,archived,new_name,NOTE`
  - インポート: 上記CSVを編集してアップロード（`archived` は無視、`NOTE` は任意）
- ログ: JSONL + テキストの2系統（`logs/`）

---

## ファイル構成

```
package.json          依存・スクリプト
public/index.html     UI（CSVダウンロード、アップロード、ドライラン/適用）
src/server.js         Expressルート（API, 静的配信）
src/slack.js          Slack APIクライアント（一覧/リネーム）
src/validation.js     名前正規化/検証ロジック
src/writeLogs.js      ログ出力（.jsonl / .log）
logs/                 実行ログ（Git管理外）
```

---

## API 仕様（サーバ内部）

- `GET /api/auth-status`
  - 戻り値: `{ user: {ok, team, user} | {ok:false}, admin: {ok, ...} | {ok:false} }`
- `GET /api/channels/export?types=public_channel,private_channel&include_archived=true|false`
  - Slack `conversations.list` を全ページング
  - CSVをダウンロード（列は上記順）
- `POST /api/rename/dry-run`（`Content-Type: application/json` または `multipart/form-data`）
  - 入力: `rows: [{channel_id,current_name,new_name,NOTE?}]` もしくは `file`（CSV）
  - 戻り値: `{ plan: [{ status: will_rename|invalid|noop|skipped, ... }] }`
- `POST /api/rename/apply`（同上）
  - 成功/失敗を逐次ログへ書き込み
  - 戻り値: `{ results: [...], logs: { logPath, jsonlPath } }`

---

## 権限・スコープ

### 一覧取得（conversations.list）

- 推奨スコープ: `channels:read`, `groups:read`（Conversations API相当）
- `exclude_archived` を制御（UIのチェックボックスに連動）

### リネーム（conversations.rename）

- 必要スコープ: `channels:manage`（public）, `groups:write`（private）
- 実行ロール: チャンネル作成者 / Workspace Admin / Channel Manager

### リネーム（admin.conversations.rename）

- Enterprise Grid 専用、Org Admin の Adminアプリ
- 必要スコープ: `admin.conversations:write`

---

## 命名ルール（正規化/検証）

- 正規化
  - NFKC正規化 + ASCII英字のみ小文字化
  - 空白は `-` へ置換
  - 許容: Unicodeの文字・数字・`_`・`-`
  - 先頭/末尾の `-` は除去（`_`は保持）
  - 最大80文字に丸め
- 検証
  - 先頭は Unicode 文字/数字
  - 全体は Unicode 文字/数字/`_`/`-` のみ

---

## セキュリティ

- トークンは環境変数（`SLACK_USER_TOKEN`, `SLACK_ADMIN_TOKEN`）で注入
- ログ/CSVへトークンは出力しない
- `.gitignore` に `logs/`, `.env` 登録済み

---

## 運用フロー（UI）

1. トークン設定後、`npm start` → ブラウザで `http://localhost:3000`
2. エクスポート（必要なら「アーカイブも含める」をON）
3. CSV編集（`new_name` と任意 `NOTE`）
4. ドライランで差分確認（`invalid`/`noop`/`will_rename`）
5. 本番反映（結果は画面と `logs/` に出力）

---

## 拡張案

- ドライラン結果のUIに `archived` 表示/フィルタを追加
- 名前重複（`name_taken`）時の自動suffix付与、重複検出プレビュー
- Undo計画（旧名へのロールバックCSV生成）
- Sheets/Notion 連携、SAML属性からの命名規則自動生成

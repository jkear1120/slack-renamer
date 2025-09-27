# Slack Channel CSV Renamer

Slack のチャンネル一覧を **CSV 形式でエクスポート／編集／インポート更新** できるツールです。  
ブラウザUIから操作（CSVエクスポート/アップロード、ドライラン/本番反映）が可能で、CLIなしでも運用できます。

## 特徴
- 全チャンネルを CSV で出力（`channel_id,current_name,new_name,notes`）
- CSV 編集後、`new_name` 列に入力された名前で一括リネーム
- Slack の命名制約（小文字/数字/ハイフン/アンダースコア、80 文字以内）を自動正規化・検証
- **ドライラン**で確認 → **本番反映**で適用
- 実行ログを `logs/` に保存（人間可読 `.log` と機械可読 `.jsonl`）

---

## 必要環境
- Node.js 18 以上
- Slack トークン
  - Workspace 単体: `SLACK_USER_TOKEN`  
  - Enterprise Grid 全社横断: `SLACK_ADMIN_TOKEN`

## セットアップ（ローカルUI）
```bash
git clone git@github.com:jkear1120/slack-renamer.git
cd slack-renamer
npm install
```

### トークン設定（どちらか／両方）
- Workspace 単体: `SLACK_USER_TOKEN`（例: `xoxp-...`）
- Enterprise Grid 全社横断: `SLACK_ADMIN_TOKEN`（例: `xoxe-...`）

起動例:
```bash
# Workspaceトークンのみ
SLACK_USER_TOKEN=xoxp-*** npm start

# Adminトークン併用（Org横断リネームが可能）
SLACK_USER_TOKEN=xoxp-*** SLACK_ADMIN_TOKEN=xoxe-*** npm start
```

ブラウザで `http://localhost:3000` を開きます。

---

## 使い方（ブラウザUI）
1. 画面上部の「トークン状態」を確認（User/Adminどちらが有効か）
2. エクスポート
   - types（`public_channel,private_channel` など）を指定
   - オプション「アーカイブも含める」を必要に応じてON
   - 「CSVダウンロード」で取得
3. CSV編集
   - 列は `channel_id,current_name,new_name,notes` 固定
   - `new_name` に希望名を記入（空欄はスキップ扱い）
4. インポート＆ドライラン
   - 「CSVインポート」→「ドライラン」で計画・検証
5. 本番反映
   - 問題なければ「本番反映」
   - Adminモード（チェックON）で `admin.conversations.rename` を使用

---

## CSV列構成（エクスポート）

`channel_id,current_name,channel_type,archived,new_name,NOTE`

- `channel_type`: `public` | `private`
- `archived`: `active` | `archived`
- `NOTE`: 任意メモ（最右列）

インポート時の注意:
- `archived` 列は読み込み時に無視されます（表示用途のみ）
- `NOTE` は任意。列名が `NOTE` または `notes` のどちらでも読み込めます

## ログ出力

* `logs/run-*.log` … 人間可読
* `logs/run-*.jsonl` … 機械可読（監査・再集計用）

---

## 注意点

* Slack の命名制約を満たさない名前は自動修正またはスキップされます。
* リネーム実行には以下の権限が必要です:

  * **Workspace**: チャンネル作成者 / Workspace Admin / Channel Manager
  * **Enterprise Grid**: Org Admin が `admin.conversations.rename` を利用

必要なOAuthスコープの例:
- エクスポート: `channels:read`, `groups:read`（Conversations APIの実質権限）
- リネーム（Workspace）: `channels:manage`（public）, `groups:write`（private）
- リネーム（Admin）: `admin.conversations:write` と Org 管理者権限

---

## ライセンス

内部利用限定

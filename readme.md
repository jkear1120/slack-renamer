# Slack Channel CSV Renamer

Slack のチャンネル一覧を **CSV 形式でエクスポート／編集／インポート更新** できるツールです。  
ブラウザUIから操作（CSVエクスポート/アップロード、プレビュー/本番反映）が可能で、CLIなしでも運用できます。

## 特徴
- 全チャンネルを CSV で出力（`channel_id,current_name,channel_type,archived,new_name,NOTE`）
- CSV 編集後、`new_name` 列で一括リネーム（`NOTE` は任意メモ）
- Slack の命名制約（Unicode文字/数字/ハイフン/アンダースコア、80 文字以内・先頭は文字/数字）を自動正規化・検証
- **プレビュー**で確認 → **本番反映**で適用
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
   - 「プレビュー表示」で一覧を確認 → 問題なければ「CSVダウンロード」で取得
3. CSV編集
   - エクスポートCSVを編集（`new_name` を記入、`NOTE` は任意）
4. インポート＆プレビュー
   - 「CSVインポート」→「プレビュー」で計画・検証（適用は行いません）
5. 本番反映
   - 「最終確認しました」にチェックを入れてから「本番反映」を実行
   - Adminモード（チェックON）で `admin.conversations.rename` を使用

---

## CSV列構成（エクスポート）

`channel_id,channel_link,current_name,channel_type,connect,archived,new_name,NOTE`

- `channel_type`: `public` | `private`
- `connect`: `external`（外部組織と接続）| `org`（同一Org内共有）| `shared`（共有だが外部/Org不明の旧型）| `none`（共有なし）
- `archived`: `active` | `archived`
- `channel_link`: `https://app.slack.com/client/<team_id>/<channel_id>` 形式の直接リンク（UIでクリック可能）
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

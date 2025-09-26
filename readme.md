# Slack Channel CSV Renamer

Slack のチャンネル一覧を **CSV 形式でエクスポート／編集／インポート更新** できる CLI ツールです。  
リネーム操作は **ドライラン → 承認 → 本番反映** の流れで、安全に実施できます。

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

## インストール
```bash
git clone <repo>
cd slack-channel-csv-renamer
npm install
````

---

## 使い方

### 1. チャンネル一覧を CSV エクスポート

```bash
SLACK_USER_TOKEN=xoxp-*** npm run export -- --types public_channel,private_channel --out ./channels_export.csv
```

→ `channels_export.csv` が生成されます。

### 2. CSV を編集

* 列は `channel_id,current_name,new_name,notes` のまま固定
* `new_name` に変更後のチャンネル名を入力（空欄はスキップ）

### 3. ドライラン（計画のみ出力）

```bash
SLACK_USER_TOKEN=xoxp-*** npm run import -- --csv ./channels_export.csv
```

### 4. 本番反映

```bash
# Workspace の場合
SLACK_USER_TOKEN=xoxp-*** npm run import -- --csv ./channels_export.csv --apply

# Enterprise Grid の場合
SLACK_ADMIN_TOKEN=xoxe-*** npm run import -- --csv ./channels_export.csv --apply --admin
```

---

## ログ出力

* `logs/run-*.log` … 人間可読
* `logs/run-*.jsonl` … 機械可読（監査・再集計用）

---

## 注意点

* Slack の命名制約を満たさない名前は自動修正またはスキップされます。
* リネーム実行には以下の権限が必要です:

  * **Workspace**: チャンネル作成者 / Workspace Admin / Channel Manager
  * **Enterprise Grid**: Org Admin が `admin.conversations.rename` を利用

---

## ライセンス

内部利用限定
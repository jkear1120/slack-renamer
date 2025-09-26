# CODEX: Slack Channel CSV Renamer 技術仕様

本書は開発者／運用担当者向けに、実装構成・セキュリティレビュー・拡張指針をまとめたものです。

---

## アーキテクチャ

* Node.js CLI ツール
* Slack API: `conversations.list`, `conversations.rename`, `admin.conversations.rename`
* I/O:

  * エクスポート CSV: `channel_id,current_name,new_name,notes`
  * インポート CSV: `new_name` 列を編集
* ログ: JSONL + テキスト 2 系統

---

## ファイル構成

```
/package.json          依存と npm scripts
/scripts/lib.mjs       Slack クライアント & 共通関数
/scripts/logger.mjs    ログ出力（JSONL + テキスト）
/scripts/export-channels.mjs  CSV エクスポート
/scripts/import-rename.mjs    CSV インポート & rename 実行
/logs/                 実行ログ保存先
```

---

## 権限・スコープ

### 一覧取得（conversations.list）

* 必要スコープ: `channels:read`, `groups:read`, `im:read`, `mpim:read`
* レート制限 Tier 2（cursor で全件取得）

### リネーム（conversations.rename）

* 必要スコープ: `channels:manage` / `channels:write` / `groups:write` / `im:write` / `mpim:write`
* 実行者ロール要件: チャンネル作成者 / Workspace Admin / Channel Manager

### リネーム（admin.conversations.rename）

* Enterprise Grid 専用
* Org Admin / Owner がインストールした Admin アプリでのみ利用可能

---

## 命名制約

* 小文字 / 数字 / `-` / `_` のみ許可
* 最大長: 80 文字
* 自動正規化（空白 → ハイフン、禁止文字削除）

---

## セキュリティレビュー

* **トークン管理**: 環境変数で指定。ログ・CSV に出力禁止。
* **権限最小化**: 一覧時は read 権限のみ、更新時に write 権限を付与。
* **監査性**: JSONL に全リクエスト結果（成功/失敗/HTTP status/Retry-After）を記録。
* **レート制御**: SDK の retry 機構 + 429 `Retry-After` をログ化。

---

## 運用フロー

1. `npm run export` → CSV 出力
2. CSV 編集（`new_name` 列に記入）
3. `npm run import` （dry-run）
4. `npm run import -- --apply` （本番反映）
5. ログ (`logs/run-*.log`, `logs/run-*.jsonl`) を保存

---

## 拡張案

* CI/CD パイプラインに組み込み、承認後に `--apply` 実行
* CSV ではなく Google Sheets API と連携
* 名前重複 (`name_taken`) 検出時にリトライ用 suffix を自動付与
* 社内命名規則（prefix/部署コード）をエクスポート時に自動生成
const path = require('path');
const fs = require('fs');
const express = require('express');
const morgan = require('morgan');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const { SlackService } = require('./slack');
const { normalizeChannelName, validateChannelName } = require('./validation');
const { RunLogger } = require('./writeLogs');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

const PORT = process.env.PORT || 3000;

const slack = new SlackService({
  userToken: process.env.SLACK_USER_TOKEN,
  adminToken: process.env.SLACK_ADMIN_TOKEN,
});

app.get('/api/auth-status', async (req, res) => {
  try {
    const userAuth = slack.userToken ? await slack.authTest('user') : null;
    const adminAuth = slack.adminToken ? await slack.authTest('admin') : null;
    res.json({
      user: userAuth ? { ok: true, team: userAuth.team, team_id: userAuth.team_id, user: userAuth.user, user_id: userAuth.user_id } : { ok: false },
      admin: adminAuth ? { ok: true, team: adminAuth.team, team_id: adminAuth.team_id, user: adminAuth.user, user_id: adminAuth.user_id } : { ok: false },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Export channels as CSV
app.get('/api/channels/export', async (req, res) => {
  try {
    const types = String(req.query.types || 'public_channel,private_channel');
    const includeArchived = String(req.query.include_archived || 'false') === 'true';
    const channels = await slack.listAllChannels({ types, includeArchived });
    const records = channels.map((c) => {
      const connect = c.is_ext_shared ? 'external' : (c.is_org_shared ? 'org' : (c.is_shared ? 'shared' : 'none'));
      return {
        channel_id: c.id,
        current_name: c.name,
        channel_type: c.is_private ? 'private' : 'public',
        connect,
        archived: c.is_archived ? 'archived' : 'active',
        new_name: '',
        NOTE: '',
      };
    });
    const csv = stringify(records, { header: true, columns: ['channel_id', 'current_name', 'channel_type', 'connect', 'archived', 'new_name', 'NOTE'] });
    const ts = Date.now();
    const filename = `channels_export_${ts}.csv`;
    // 保存（履歴用）
    try {
      const fs = require('fs');
      const path = require('path');
      const logsDir = path.join(process.cwd(), 'logs');
      if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
      const outPath = path.join(logsDir, `export-${ts}.csv`);
      fs.writeFileSync(outPath, csv);
    } catch (e) {
      // ベストエフォートで保存、失敗してもレスポンスは返す
      console.warn('failed to write export history:', e.message);
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Preview channels as JSON (same columns as CSV export, without download)
app.get('/api/channels/preview', async (req, res) => {
  try {
    const types = String(req.query.types || 'public_channel,private_channel');
    const includeArchived = String(req.query.include_archived || 'false') === 'true';
    const channels = await slack.listAllChannels({ types, includeArchived });
    const records = channels.map((c) => {
      const connect = c.is_ext_shared ? 'external' : (c.is_org_shared ? 'org' : (c.is_shared ? 'shared' : 'none'));
      return {
        channel_id: c.id,
        current_name: c.name,
        channel_type: c.is_private ? 'private' : 'public',
        connect,
        archived: c.is_archived ? 'archived' : 'active',
      };
    });
    res.json({ count: records.length, records });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Dry-run rename using uploaded CSV or JSON rows
app.post('/api/rename/dry-run', upload.single('file'), async (req, res) => {
  try {
    const admin = req.body.admin === 'true' || req.query.admin === 'true';

    let rows = [];
    if (req.file) {
      rows = parse(req.file.buffer.toString('utf8'), { columns: true, skip_empty_lines: true });
    } else if (Array.isArray(req.body.rows)) {
      rows = req.body.rows;
    }

    if (!rows.length) return res.status(400).json({ error: 'No rows provided' });

    const plan = [];
    for (const r of rows) {
      const channelId = String(r.channel_id || '').trim();
      const current = String(r.current_name || '').trim();
      const requested = String(r.new_name || '').trim();
      const notes = r.NOTE || r.notes || '';
      const archived = (r.archived || '').toString().toLowerCase();
      const channel_type = (r.channel_type || '').toString().toLowerCase();

      if (!channelId || !requested) {
        plan.push({ channel_id: channelId, current_name: current, requested_name: requested, status: 'skipped', reason: 'missing_channel_id_or_new_name', notes, archived, channel_type });
        continue;
      }

      const normalized = normalizeChannelName(requested);
      const validation = validateChannelName(normalized);
      if (!validation.valid) {
        plan.push({ channel_id: channelId, current_name: current, requested_name: requested, normalized_name: normalized, status: 'invalid', reason: validation.reason, notes, archived, channel_type });
        continue;
      }

      if (normalized === current) {
        plan.push({ channel_id: channelId, current_name: current, requested_name: requested, normalized_name: normalized, status: 'noop', reason: 'same_as_current', notes, archived, channel_type });
        continue;
      }

      plan.push({ channel_id: channelId, current_name: current, requested_name: requested, normalized_name: normalized, status: 'will_rename', notes, archived, channel_type });
    }

    return res.json({ admin, dryRun: true, count: plan.length, plan });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Apply rename from uploaded CSV or JSON rows
app.post('/api/rename/apply', upload.single('file'), async (req, res) => {
  const logger = new RunLogger({ dryRun: false });
  try {
    const admin = req.body.admin === 'true' || req.query.admin === 'true';

    let rows = [];
    let originalCsvBuffer = null;
    if (req.file) {
      originalCsvBuffer = Buffer.from(req.file.buffer);
      rows = parse(req.file.buffer.toString('utf8'), { columns: true, skip_empty_lines: true });
    } else if (Array.isArray(req.body.rows)) {
      rows = req.body.rows;
    }
    if (!rows.length) return res.status(400).json({ error: 'No rows provided' });

    const results = [];
    const revertItems = [];
    for (const r of rows) {
      const channelId = String(r.channel_id || '').trim();
      const current = String(r.current_name || '').trim();
      const requested = String(r.new_name || '').trim();
      const notes = r.NOTE || r.notes || '';
      const archived = (r.archived || '').toString().toLowerCase();
      const channel_type = (r.channel_type || '').toString().toLowerCase();
      if (!channelId || !requested) {
        const item = { channel_id: channelId, current_name: current, requested_name: requested, status: 'skipped', reason: 'missing_channel_id_or_new_name', notes, archived, channel_type };
        results.push(item);
        logger.jsonl(item);
        continue;
      }

      const normalized = normalizeChannelName(requested);
      const validation = validateChannelName(normalized);
      if (!validation.valid) {
        const item = { channel_id: channelId, current_name: current, requested_name: requested, normalized_name: normalized, status: 'invalid', reason: validation.reason, notes, archived, channel_type };
        results.push(item);
        logger.jsonl(item);
        continue;
      }

      if (normalized === current) {
        const item = { channel_id: channelId, current_name: current, requested_name: requested, normalized_name: normalized, status: 'noop', reason: 'same_as_current', notes, archived, channel_type };
        results.push(item);
        logger.jsonl(item);
        continue;
      }

      try {
        const resp = await slack.renameChannel({ channelId, name: normalized, admin });
        const item = { channel_id: channelId, from: current, to: normalized, status: 'renamed', ts: Date.now(), api_result: resp.ok === true, notes, archived, channel_type };
        results.push(item);
        logger.jsonl(item);
        revertItems.push({ channel_id: channelId, from: current, to: normalized });
      } catch (err) {
        const item = { channel_id: channelId, from: current, to: normalized, status: 'error', error: err.message, notes, archived, channel_type };
        results.push(item);
        logger.jsonl(item);
      }
    }

    // 保存: 元に戻す用メタ
    try {
      const revertMeta = { batchId: logger.id, admin, createdAt: Date.now(), items: revertItems };
      const revertPath = require('path').join(process.cwd(), 'logs', `revert-${logger.id}.json`);
      require('fs').writeFileSync(revertPath, JSON.stringify(revertMeta, null, 2));
    } catch (e) {
      logger.jsonl({ status: 'warn', warn: 'failed_to_write_revert_meta', error: e.message });
    }

    // 保存: インポートCSV履歴
    try {
      const fs = require('fs');
      const path = require('path');
      const logsDir = path.join(process.cwd(), 'logs');
      if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
      const importPath = path.join(logsDir, `import-${logger.id}.csv`);
      if (originalCsvBuffer) {
        fs.writeFileSync(importPath, originalCsvBuffer);
      } else {
        // rows からCSV再生成
        const columns = ['channel_id','current_name','channel_type','connect','archived','new_name','NOTE'];
        const csvFromRows = stringify(rows, { header: true, columns: columns.filter(c => rows.some(r => c in r)) });
        fs.writeFileSync(importPath, csvFromRows);
      }
    } catch (e) {
      logger.jsonl({ status: 'warn', warn: 'failed_to_write_import_csv', error: e.message });
    }

    logger.humanSummary(results);
    const { id, jsonlPath, logPath } = logger.close();
    res.json({ admin, applied: true, batchId: id, count: results.length, results, logs: { jsonlPath, logPath } });
  } catch (e) {
    logger.jsonl({ status: 'fatal', error: e.message });
    const { id, jsonlPath, logPath } = logger.close();
    res.status(500).json({ error: e.message, batchId: id, logs: { jsonlPath, logPath } });
  }
});

// Revert last apply by batchId
app.post('/api/rename/revert', async (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const logger = new RunLogger({ dryRun: false });
  try {
    const batchId = String(req.query.batch_id || req.body?.batch_id || '').trim();
    if (!batchId) return res.status(400).json({ error: 'batch_id is required' });
    const revertPath = path.join(process.cwd(), 'logs', `revert-${batchId}.json`);
    if (!fs.existsSync(revertPath)) return res.status(404).json({ error: 'revert batch not found' });
    const meta = JSON.parse(fs.readFileSync(revertPath, 'utf-8'));
    const admin = meta.admin === true;

    const results = [];
    for (const it of meta.items) {
      try {
        const resp = await slack.renameChannel({ channelId: it.channel_id, name: it.from, admin });
        const item = { channel_id: it.channel_id, from: it.to, to: it.from, status: 'reverted', api_result: resp.ok === true, ts: Date.now() };
        results.push(item);
        logger.jsonl(item);
      } catch (err) {
        const item = { channel_id: it.channel_id, from: it.to, to: it.from, status: 'error', error: err.message };
        results.push(item);
        logger.jsonl(item);
      }
    }

    const { id, jsonlPath, logPath } = logger.close();
    res.json({ reverted: true, sourceBatchId: batchId, revertBatchId: id, count: results.length, results, logs: { jsonlPath, logPath } });
  } catch (e) {
    const { id, jsonlPath, logPath } = logger.close();
    res.status(500).json({ error: e.message, revertBatchId: id, logs: { jsonlPath, logPath } });
  }
});

// Logs: list
app.get('/api/logs/list', async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(dir)) return res.json({ files: [] });
    const items = fs.readdirSync(dir)
      .filter((n) => /\.(log|jsonl|json|csv)$/i.test(n))
      .map((name) => {
        const stat = fs.statSync(path.join(dir, name));
        let kind = 'other';
        if (name.startsWith('run-') && name.endsWith('.jsonl')) kind = 'jsonl';
        else if (name.startsWith('run-') && name.endsWith('.log')) kind = 'log';
        else if (name.startsWith('revert-') && name.endsWith('.json')) kind = 'revert';
        else if (name.startsWith('export-') && name.endsWith('.csv')) kind = 'export';
        else if (name.startsWith('import-') && name.endsWith('.csv')) kind = 'import';
        return { name, size: stat.size, mtime: stat.mtimeMs, kind };
      })
      .sort((a,b) => b.mtime - a.mtime);
    res.json({ files: items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Logs: download file
app.get('/api/logs/get', async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const name = String(req.query.name || '');
    if (!name || name.includes('/') || name.includes('..')) return res.status(400).json({ error: 'invalid name' });
    const p = path.join(process.cwd(), 'logs', name);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'not found' });
    res.download(p, name);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Logs: read text (preview)
app.get('/api/logs/view', async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const name = String(req.query.name || '');
    if (!name || name.includes('/') || name.includes('..')) return res.status(400).json({ error: 'invalid name' });
    const p = path.join(process.cwd(), 'logs', name);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'not found' });
    const buf = fs.readFileSync(p);
    res.type('text/plain').send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use('/', express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Slack Renamer UI running at ${url}`);
});

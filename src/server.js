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
      user: userAuth ? { ok: true, team: userAuth.team, user: userAuth.user } : { ok: false },
      admin: adminAuth ? { ok: true, team: adminAuth.team, user: adminAuth.user } : { ok: false },
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
    const filename = `channels_export_${Date.now()}.csv`;
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

      if (!channelId || !requested) {
        plan.push({ channel_id: channelId, current_name: current, requested_name: requested, status: 'skipped', reason: 'missing_channel_id_or_new_name', notes });
        continue;
      }

      const normalized = normalizeChannelName(requested);
      const validation = validateChannelName(normalized);
      if (!validation.valid) {
        plan.push({ channel_id: channelId, current_name: current, requested_name: requested, normalized_name: normalized, status: 'invalid', reason: validation.reason, notes });
        continue;
      }

      if (normalized === current) {
        plan.push({ channel_id: channelId, current_name: current, requested_name: requested, normalized_name: normalized, status: 'noop', reason: 'same_as_current', notes });
        continue;
      }

      plan.push({ channel_id: channelId, current_name: current, requested_name: requested, normalized_name: normalized, status: 'will_rename', notes });
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
    if (req.file) {
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
      if (!channelId || !requested) {
        const item = { channel_id: channelId, current_name: current, requested_name: requested, status: 'skipped', reason: 'missing_channel_id_or_new_name', notes };
        results.push(item);
        logger.jsonl(item);
        continue;
      }

      const normalized = normalizeChannelName(requested);
      const validation = validateChannelName(normalized);
      if (!validation.valid) {
        const item = { channel_id: channelId, current_name: current, requested_name: requested, normalized_name: normalized, status: 'invalid', reason: validation.reason, notes };
        results.push(item);
        logger.jsonl(item);
        continue;
      }

      if (normalized === current) {
        const item = { channel_id: channelId, current_name: current, requested_name: requested, normalized_name: normalized, status: 'noop', reason: 'same_as_current', notes };
        results.push(item);
        logger.jsonl(item);
        continue;
      }

      try {
        const resp = await slack.renameChannel({ channelId, name: normalized, admin });
        const item = { channel_id: channelId, from: current, to: normalized, status: 'renamed', ts: Date.now(), api_result: resp.ok === true, notes };
        results.push(item);
        logger.jsonl(item);
        revertItems.push({ channel_id: channelId, from: current, to: normalized });
      } catch (err) {
        const item = { channel_id: channelId, from: current, to: normalized, status: 'error', error: err.message, notes };
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

app.use('/', express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Slack Renamer UI running at ${url}`);
});

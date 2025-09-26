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
    const channels = await slack.listAllChannels({ types });
    const records = channels.map((c) => ({
      channel_id: c.id,
      current_name: c.name,
      new_name: '',
      notes: '',
    }));
    const csv = stringify(records, { header: true, columns: ['channel_id', 'current_name', 'new_name', 'notes'] });
    const filename = `channels_export_${Date.now()}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(csv);
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
      const notes = r.notes || '';

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
    for (const r of rows) {
      const channelId = String(r.channel_id || '').trim();
      const current = String(r.current_name || '').trim();
      const requested = String(r.new_name || '').trim();
      const notes = r.notes || '';
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
      } catch (err) {
        const item = { channel_id: channelId, from: current, to: normalized, status: 'error', error: err.message, notes };
        results.push(item);
        logger.jsonl(item);
      }
    }

    logger.humanSummary(results);
    const { jsonlPath, logPath } = logger.close();
    res.json({ admin, applied: true, count: results.length, results, logs: { jsonlPath, logPath } });
  } catch (e) {
    logger.jsonl({ status: 'fatal', error: e.message });
    const { jsonlPath, logPath } = logger.close();
    res.status(500).json({ error: e.message, logs: { jsonlPath, logPath } });
  }
});

app.use('/', express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Slack Renamer UI running at ${url}`);
});


const fs = require('fs');
const path = require('path');
const { nanoid } = require('nanoid');

class RunLogger {
  constructor({ dryRun = false } = {}) {
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const id = `${Date.now()}_${nanoid(6)}`;
    this.jsonlPath = path.join(logsDir, `run-${id}.jsonl`);
    this.logPath = path.join(logsDir, `run-${id}.log`);
    this.jsonlStream = fs.createWriteStream(this.jsonlPath, { flags: 'a' });
    this.logStream = fs.createWriteStream(this.logPath, { flags: 'a' });
    this.human(`Start run: dryRun=${dryRun}`);
  }

  jsonl(obj) {
    this.jsonlStream.write(JSON.stringify({ ts: Date.now(), ...obj }) + '\n');
  }

  human(line) {
    this.logStream.write(`[${new Date().toISOString()}] ${line}\n`);
  }

  humanSummary(results) {
    const grouped = results.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});
    this.human(`Summary: ${JSON.stringify(grouped)}`);
  }

  close() {
    this.jsonlStream.end();
    this.logStream.end();
    return { jsonlPath: this.jsonlPath, logPath: this.logPath };
  }
}

module.exports = { RunLogger };


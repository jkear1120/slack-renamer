const { WebClient } = require('@slack/web-api');

class SlackService {
  constructor({ userToken, adminToken }) {
    this.userToken = userToken || null;
    this.adminToken = adminToken || null;
    this.userClient = this.userToken ? new WebClient(this.userToken) : null;
    this.adminClient = this.adminToken ? new WebClient(this.adminToken) : null;
  }

  async authTest(kind = 'user') {
    const client = kind === 'admin' ? this.adminClient : this.userClient;
    if (!client) return null;
    const r = await client.auth.test();
    return r;
  }

  async listAllChannels({ types = 'public_channel,private_channel', limit = 1000 }) {
    if (!this.userClient) throw new Error('SLACK_USER_TOKEN is not set');
    const channels = [];
    let cursor;
    do {
      const resp = await this.userClient.conversations.list({ types, limit: 1000, cursor });
      channels.push(...(resp.channels || []));
      cursor = resp.response_metadata?.next_cursor;
    } while (cursor);
    return channels;
  }

  async renameChannel({ channelId, name, admin = false }) {
    if (admin) {
      if (!this.adminClient) throw new Error('SLACK_ADMIN_TOKEN is not set');
      const r = await this.adminClient.admin.conversations.rename({ channel_id: channelId, name });
      if (!r.ok) throw new Error(r.error || 'admin.rename_failed');
      return r;
    }
    if (!this.userClient) throw new Error('SLACK_USER_TOKEN is not set');
    const r = await this.userClient.conversations.rename({ channel: channelId, name });
    if (!r.ok) throw new Error(r.error || 'rename_failed');
    return r;
  }
}

module.exports = { SlackService };


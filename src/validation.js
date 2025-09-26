function normalizeChannelName(input) {
  if (!input) return '';
  let s = String(input).trim().toLowerCase();
  // Replace spaces with hyphens
  s = s.replace(/\s+/g, '-');
  // Allow only lowercase letters, numbers, hyphen, underscore
  s = s.replace(/[^a-z0-9-_]/g, '-');
  // Collapse multiple hyphens
  s = s.replace(/-+/g, '-');
  // Trim to 80 chars
  if (s.length > 80) s = s.slice(0, 80);
  // Remove leading/trailing hyphens/underscores
  s = s.replace(/^[-_]+|[-_]+$/g, '');
  return s;
}

function validateChannelName(name) {
  if (!name) return { valid: false, reason: 'empty' };
  if (name.length > 80) return { valid: false, reason: 'too_long' };
  if (!/^[a-z0-9][a-z0-9-_]*$/.test(name)) return { valid: false, reason: 'invalid_chars_or_start' };
  return { valid: true };
}

module.exports = { normalizeChannelName, validateChannelName };


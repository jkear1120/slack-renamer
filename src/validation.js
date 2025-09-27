function normalizeChannelName(input) {
  if (!input) return '';
  let s = String(input).trim();
  // Normalize and lowercase ASCII letters; non-ASCII remains as-is
  s = s.normalize('NFKC').toLowerCase();
  // Replace whitespace with hyphen
  s = s.replace(/\s+/gu, '-');
  // Keep Unicode letters/numbers, underscore, hyphen; drop other punctuation
  s = s.replace(/[^\p{L}\p{N}_-]/gu, '');
  // Collapse multiple hyphens
  s = s.replace(/-+/g, '-');
  // Trim to 80 chars
  if (s.length > 80) s = s.slice(0, 80);
  // Trim only hyphens from edges (underscores may be meaningful)
  s = s.replace(/^-+|-+$/g, '');
  return s;
}

function validateChannelName(name) {
  if (!name) return { valid: false, reason: 'empty' };
  if (name.length > 80) return { valid: false, reason: 'too_long' };
  // Must start with a letter or number; allow Unicode letters/numbers, underscore, hyphen thereafter
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(name)) return { valid: false, reason: 'invalid_chars_or_start' };
  return { valid: true };
}

module.exports = { normalizeChannelName, validateChannelName };

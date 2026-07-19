'use strict';

function normalize(value = '') {
  return value.toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function queryTerms(query) {
  const normalized = normalize(query);
  const terms = new Set(normalized.match(/[a-z0-9][a-z0-9._+-]*/g) || []);
  for (const segment of normalized.match(/[\u3400-\u9fff]+/g) || []) {
    if (segment.length <= 4) terms.add(segment);
    for (let index = 0; index < segment.length - 1; index += 1) {
      terms.add(segment.slice(index, index + 2));
    }
  }
  return [...terms].filter(Boolean);
}

function scoreText(query, text, title = '') {
  const haystack = normalize(text);
  const normalizedTitle = normalize(title);
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return 0;
  let score = 0;
  if (normalizedTitle.includes(normalizedQuery)) score += 80;
  if (haystack.includes(normalizedQuery)) score += 40;
  for (const term of queryTerms(query)) {
    if (normalizedTitle.includes(term)) score += 8;
    const first = haystack.indexOf(term);
    if (first >= 0) score += 2 + Math.min(4, haystack.split(term).length - 1);
  }
  return score;
}

function excerptFor(query, text, length = 180) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  const normalized = normalize(compact);
  const candidates = [normalize(query), ...queryTerms(query)].filter(Boolean);
  let position = -1;
  for (const candidate of candidates) {
    position = normalized.indexOf(candidate);
    if (position >= 0) break;
  }
  if (position < 0) return compact.slice(0, length);
  const start = Math.max(0, position - Math.floor(length / 3));
  return `${start > 0 ? '…' : ''}${compact.slice(start, start + length)}${start + length < compact.length ? '…' : ''}`;
}

function chunkText(text, size = 1400, overlap = 180) {
  const value = String(text || '').trim();
  if (!value) return [];
  const chunks = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(value.length, start + size);
    if (end < value.length) {
      const boundary = Math.max(value.lastIndexOf('\n', end), value.lastIndexOf('。', end));
      if (boundary > start + Math.floor(size * 0.6)) end = boundary + 1;
    }
    chunks.push(value.slice(start, end));
    if (end >= value.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

module.exports = { normalize, queryTerms, scoreText, excerptFor, chunkText };

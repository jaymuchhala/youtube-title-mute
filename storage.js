// The muted words live in chrome.storage.sync so they follow the browser
// profile. Sync caps each item at 8 KB, so the newline-joined list is split
// across numbered chunks: "words.count", "words.0", ...
const WordStore = (() => {
  const CHUNK_CHARS = 7000;

  // Lowercase, single-spaced, 2-100 chars. "*" is a wildcard (see content.js).
  function normalize(raw) {
    const s = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
    return s.replace(/\*/g, '').length >= 2 && s.length <= 100 ? s : null;
  }

  const clean = (words) => [...new Set((words || []).map(normalize).filter(Boolean))].sort();

  async function load() {
    const all = await chrome.storage.sync.get(null);
    const chunks = [];
    for (let i = 0; i < (all['words.count'] || 0); i++) chunks.push(all['words.' + i] || '');
    return { words: chunks.join('\n').split('\n').filter(Boolean) };
  }

  async function save(list) {
    const prev = await chrome.storage.sync.get(null);
    const chunks = [];
    let chunk = '';
    for (const word of clean(list.words)) {
      const next = chunk ? chunk + '\n' + word : word;
      if (next.length > CHUNK_CHARS) {
        chunks.push(chunk);
        chunk = word;
      } else {
        chunk = next;
      }
    }
    if (chunk) chunks.push(chunk);
    const data = { 'words.count': chunks.length };
    chunks.forEach((c, i) => { data['words.' + i] = c; });
    const stale = [];
    for (let i = chunks.length; ('words.' + i) in prev; i++) stale.push('words.' + i);
    try {
      await chrome.storage.sync.set(data);
    } catch (err) {
      throw new Error(/quota/i.test(err.message) ? 'The word list is too big for browser sync (100 KB limit).' : err.message);
    }
    if (stale.length) await chrome.storage.sync.remove(stale);
  }

  function onChange(callback) {
    chrome.storage.onChanged.addListener((_changes, area) => {
      if (area === 'sync') load().then(callback);
    });
  }

  return { normalize, clean, load, save, onChange };
})();

// The muted words live in chrome.storage.sync so they follow the browser
// profile. Sync caps each item at 8 KB, so the newline-joined list is split
// across numbered chunks: "words.count", "words.0", ... Exempt channels are
// chunked the same way ("channels.count", ...), with "channelsOn" as the toggle.
const WordStore = (() => {
  const CHUNK_CHARS = 7000;

  // Lowercase, single-spaced, 2-100 chars. "*" is a wildcard (see content.js).
  function normalize(raw) {
    const s = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
    return s.replace(/\*/g, '').length >= 2 && s.length <= 100 ? s : null;
  }

  const clean = (words) => [...new Set((words || []).map(normalize).filter(Boolean))].sort();

  // A channel is its @handle or its lowercase name. Handles can come from a
  // link or path ("/@name/videos"), where non-ASCII ones are percent-encoded.
  function normalizeChannel(raw) {
    const s = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const handle = s.match(/^(?:.*\/)?(@[^/?#\s]+)(?:[/?#].*)?$/);
    let key = handle ? handle[1] : s;
    try { key = decodeURIComponent(key); } catch (_) { /* a name with a stray % */ }
    return key && key.length <= 100 ? key : null;
  }

  const cleanChannels = (channels) => [...new Set((channels || []).map(normalizeChannel).filter(Boolean))].sort();

  function readChunks(all, key) {
    const chunks = [];
    for (let i = 0; i < (all[key + '.count'] || 0); i++) chunks.push(all[key + '.' + i] || '');
    return chunks.join('\n').split('\n').filter(Boolean);
  }

  function writeChunks(data, stale, prev, key, items) {
    const chunks = [];
    let chunk = '';
    for (const item of items) {
      const next = chunk ? chunk + '\n' + item : item;
      if (next.length > CHUNK_CHARS) {
        chunks.push(chunk);
        chunk = item;
      } else {
        chunk = next;
      }
    }
    if (chunk) chunks.push(chunk);
    data[key + '.count'] = chunks.length;
    chunks.forEach((c, i) => { data[key + '.' + i] = c; });
    for (let i = chunks.length; (key + '.' + i) in prev; i++) stale.push(key + '.' + i);
  }

  async function load() {
    const all = await chrome.storage.sync.get(null);
    return { words: readChunks(all, 'words'), channels: readChunks(all, 'channels'), channelsOn: !!all.channelsOn };
  }

  async function save(list) {
    const prev = await chrome.storage.sync.get(null);
    const data = { channelsOn: !!list.channelsOn };
    const stale = [];
    writeChunks(data, stale, prev, 'words', clean(list.words));
    writeChunks(data, stale, prev, 'channels', cleanChannels(list.channels));
    try {
      await chrome.storage.sync.set(data);
    } catch (err) {
      throw new Error(/quota/i.test(err.message) ? 'The lists are too big for browser sync (100 KB limit).' : err.message);
    }
    if (stale.length) await chrome.storage.sync.remove(stale);
  }

  function onChange(callback) {
    chrome.storage.onChanged.addListener((_changes, area) => {
      if (area === 'sync') load().then(callback);
    });
  }

  return { normalize, normalizeChannel, clean, load, save, onChange };
})();

const $ = (id) => document.getElementById(id);

// The same page serves as the toolbar popup and the options tab. File pickers
// close the popup on some platforms, so restoring happens in the tab.
const isPopup = chrome.extension.getViews({ type: 'popup' }).includes(window);
document.body.classList.toggle('popup', isPopup);

let state = null;
let editing = false;

function setStatus(message, isError = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', isError);
}

async function save(next) {
  try {
    await WordStore.save(next);
    state = await WordStore.load();
    render();
    return true;
  } catch (err) {
    setStatus(err.message, true);
    return false;
  }
}

// Commas or new lines separate words, so phrases can contain spaces.
function parseWords(text, separator) {
  const good = [];
  const bad = [];
  for (const part of text.split(separator).map((p) => p.trim()).filter(Boolean)) {
    const word = WordStore.normalize(part);
    (word ? good : bad).push(word || part);
  }
  return { good, bad };
}

const quoted = (w) => `“${w}”`;

function render() {
  $('list-view').hidden = editing;
  $('text-view').hidden = !editing;
  const filter = $('filter').value.trim().toLowerCase();
  const words = state.words.filter((w) => w.includes(filter));
  $('list').replaceChildren(...words.map((word) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = quoted(word);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Unmute ${quoted(word)}`);
    remove.addEventListener('click', async () => {
      if (await save({ words: state.words.filter((w) => w !== word) })) setStatus(`Unmuted ${quoted(word)}`);
    });
    li.append(label, remove);
    return li;
  }));
  $('empty').hidden = words.length > 0;
  $('empty').textContent = state.words.length ? 'No matches.' : 'No words muted yet.';
}

async function usage() {
  try {
    const bytes = await chrome.storage.sync.getBytesInUse(null);
    $('usage').textContent = `${(bytes / 1024).toFixed(1)} of 100 KB synced`;
  } catch (_) { /* not critical */ }
}

$('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { good, bad } = parseWords($('add-input').value, /[,\n]+/);
  if (!good.length && !bad.length) return;
  if (good.length && await save({ words: [...state.words, ...good] })) $('add-input').value = bad.join(', ');
  setStatus(bad.length
    ? `Too short or long (2–100 characters): ${bad.join(', ')}`
    : `Muted ${good.map(quoted).join(', ')}`, bad.length > 0);
});

$('filter').addEventListener('input', render);

$('edit-text').addEventListener('click', () => {
  editing = true;
  $('text').value = state.words.join('\n');
  render();
  $('text').focus();
});

$('text-cancel').addEventListener('click', () => {
  editing = false;
  render();
});

$('text-save').addEventListener('click', async () => {
  const { good, bad } = parseWords($('text').value, /\n+/);
  if (bad.length) {
    setStatus(`Fix these first: ${bad.join(', ')}`, true);
    return;
  }
  editing = false;
  if (await save({ words: good })) setStatus(`Saved ${good.length} words`);
});

$('backup').addEventListener('click', () => {
  const data = { app: 'youtube-title-mute', version: 1, exportedAt: new Date().toISOString(), words: state.words };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = `youtube-title-mute-${new Date().toLocaleDateString('sv')}.json`; // YYYY-MM-DD in local time
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  setStatus(`Backed up ${state.words.length} words`);
});

$('restore').addEventListener('click', () => {
  if (isPopup) {
    chrome.tabs.create({ url: chrome.runtime.getURL('manage/manage.html?restore') });
    window.close();
    return;
  }
  $('restore-panel').hidden = false;
});

$('restore-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
    if (!Array.isArray(data.words)) throw new Error();
  } catch (_) {
    setStatus('That file isn’t a muted-words backup.', true);
    return;
  }
  const replace = document.querySelector('input[name="restore-mode"]:checked').value === 'replace';
  if (await save({ words: replace ? data.words : [...state.words, ...data.words] })) {
    setStatus(`Restored. Now muting ${state.words.length} words.`);
  }
  e.target.value = '';
});

WordStore.onChange((list) => {
  state = list;
  render();
  usage();
});

WordStore.load().then((list) => {
  state = list;
  render();
  usage();
  if (new URLSearchParams(location.search).has('restore')) $('restore-panel').hidden = false;
});

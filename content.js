// Hides video cards whose title has a muted word or phrase. YouTube reuses
// card elements as you scroll and navigate (the title changes in place), so
// every card is re-checked after DOM changes, at most once per frame, and
// tagged with data-ytmute for content.css to hide. With the channel toggle on,
// matches from exempt channels stay visible.

// Outermost first: a home-feed ytd-rich-item-renderer holds a yt-lockup-view-model.
const CARDS = [
  'ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-compact-video-renderer', 'ytd-grid-video-renderer',
  'ytd-playlist-video-renderer', 'ytd-playlist-panel-video-renderer', 'ytd-reel-item-renderer',
  'ytd-movie-renderer', 'ytm-shorts-lockup-view-model-v2', 'ytm-shorts-lockup-view-model', 'yt-lockup-view-model',
  // m.youtube.com
  'ytm-video-with-context-renderer', 'ytm-compact-video-renderer', 'ytm-rich-item-renderer'
].join(', ');
// Title elements: the classic #video-title link, the newer lockup <h3 title>,
// and the Shorts lockup's title link.
const TITLES = '#video-title, h3[title], a.shortsLockupViewModelHostOutsideMetadataEndpoint[title], .media-item-headline';
const CHANNEL_NAMES = 'ytd-channel-name #text, #byline';
const LOCKUP_ROWS = '.ytContentMetadataViewModelMetadataRow';
const LOCKUP_TEXT = '.ytContentMetadataViewModelMetadataText';

let matcher = null;
let exempt = null;

// Whole words or phrases, case-insensitive; "*" matches any letters, so
// "spoil*" covers "spoiler" and "spoilers".
function compileWords(words) {
  if (!words.length) return null;
  const parts = words.map((w) => w
    .split('*')
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'))
    .join('[\\p{L}\\p{N}_]*'));
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${parts.join('|')})(?![\\p{L}\\p{N}_])`, 'iu');
}

function titleOf(card) {
  const el = card.querySelector(TITLES);
  return el ? el.getAttribute('title') || el.textContent : '';
}

// Cards on a channel's own page and Shorts lockups don't name a channel, so
// the page's channel stands in for them.
function pageChannel() {
  const page = document.querySelector('ytd-browse[page-subtype="channels"]:not([hidden])');
  return [
    location.pathname,
    page?.querySelector('h1')?.textContent,
    page?.querySelector(`.ytPageHeaderViewModelContentMetadata ${LOCKUP_TEXT}`)?.textContent
  ];
}

function channelsOf(card) {
  const found = [...card.querySelectorAll('a[href^="/@"]')].map((a) => a.getAttribute('href'));
  card.querySelectorAll(CHANNEL_NAMES).forEach((el) => found.push(el.textContent));
  // Lockup rows are [channel, views and age], or only the latter when the page is the channel.
  const rows = card.querySelectorAll(LOCKUP_ROWS);
  if (rows.length > 1) found.push(rows[0].querySelector(LOCKUP_TEXT)?.textContent);
  return found.length ? found : pageChannel();
}

function isExempt(card) {
  return !!exempt && channelsOf(card).some((c) => exempt.has(WordStore.normalizeChannel(c)));
}

function check(card) {
  const hit = !!matcher && matcher.test(titleOf(card)) && !isExempt(card);
  if (hit !== card.hasAttribute('data-ytmute')) card.toggleAttribute('data-ytmute', hit);
}

function checkAll() {
  document.querySelectorAll(CARDS).forEach(check);
}

let scheduled = false;
function schedule() {
  if (scheduled || !matcher) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    checkAll();
  });
}

function update(list) {
  matcher = compileWords(list.words);
  exempt = list.channelsOn && list.channels.length ? new Set(list.channels) : null;
  checkAll();
}

WordStore.load().then(update);
WordStore.onChange(update);
new MutationObserver(schedule).observe(document.documentElement, {
  childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title']
});

// Lets the worker notice a new build.txt during development (see background.js).
try { chrome.runtime.sendMessage('ytmute:checkBuild').catch(() => {}); } catch (_) { /* extension reloaded */ }

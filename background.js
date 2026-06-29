// ===== Time Tracker - background service worker (MV3) =====
//
// Time is accrued for the active tab's domain only when:
//   1. A Chrome window is focused (Chrome is the foreground app)
//   2. The active tab is an http/https page
//   3. The user is not idle  -- OR -- the active tab is actively playing media
//      (audible or fullscreen). This lets long videos on any site (YouTube,
//      Netflix, embedded players, etc.) keep counting while you watch without
//      touching the keyboard. A *paused* tab makes no sound, so it stops.
//
// MV3 service workers aren't persistent, so we don't keep a running timer in
// memory. We persist the current session (domain + start time) to storage,
// finalize it on every relevant event, and a 1-minute alarm keeps stored data
// fresh and bounds over-count if the machine sleeps.

const SESSION_KEY = "currentSession"; // { domain, startTime } | null
const DATA_KEY = "timeData";          // { "YYYY-MM-DD": { domain: seconds } }
const FLUSH_ALARM = "flush";
const IDLE_SECONDS = 60;

// A genuine continuous session is chopped into ~60s pieces by the alarm, so any
// single commit larger than this means the worker/machine was asleep. Cap it.
const MAX_COMMIT_SECONDS = 120;

// --- simple async lock so overlapping events don't corrupt storage ---
let lock = Promise.resolve();
function withLock(fn) {
  const run = () => Promise.resolve().then(fn);
  lock = lock.then(run, run);
  return lock;
}

function todayStr(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function domainFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    let h = u.hostname;
    if (h.startsWith("www.")) h = h.slice(4);
    return h || null;
  } catch {
    return null;
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

async function chromeHasFocus() {
  try {
    const wins = await chrome.windows.getAll();
    return wins.some((w) => w.focused);
  } catch {
    return false;
  }
}

async function isWindowFullscreen(windowId) {
  try {
    const w = await chrome.windows.get(windowId);
    return w.state === "fullscreen";
  } catch {
    return false;
  }
}

// Returns the domain we should be tracking right now, or null.
async function resolveTrackingDomain() {
  if (!(await chromeHasFocus())) return null;

  const tab = await getActiveTab();
  if (!tab || !tab.url) return null;

  const domain = domainFromUrl(tab.url);
  if (!domain) return null;

  const idleState = await chrome.idle.queryState(IDLE_SECONDS);
  if (idleState === "active") return domain; // normal interactive use
  if (idleState === "locked") return null;   // screen locked -> never count

  // idle but not locked: keep counting only if the tab is actively playing
  if (tab.audible) return domain;
  if (await isWindowFullscreen(tab.windowId)) return domain;
  return null;
}

async function getState() {
  const obj = await chrome.storage.local.get([SESSION_KEY, DATA_KEY]);
  return { session: obj[SESSION_KEY] || null, data: obj[DATA_KEY] || {} };
}

async function finalize() {
  const { session, data } = await getState();
  if (session && session.domain && session.startTime) {
    const delta = Math.round((Date.now() - session.startTime) / 1000);
    if (delta > 0) {
      const seconds = Math.min(delta, MAX_COMMIT_SECONDS);
      const date = todayStr(session.startTime);
      if (!data[date]) data[date] = {};
      data[date][session.domain] = (data[date][session.domain] || 0) + seconds;
      await chrome.storage.local.set({ [DATA_KEY]: data });
    }
  }
  await chrome.storage.local.set({ [SESSION_KEY]: null });
}

async function start(domain) {
  await chrome.storage.local.set({
    [SESSION_KEY]: { domain, startTime: Date.now() },
  });
}

// Commit any open session, then start a fresh one if we should be tracking.
async function update() {
  await finalize();
  const domain = await resolveTrackingDomain();
  if (domain) await start(domain);
}

// ---------- event wiring ----------
chrome.tabs.onActivated.addListener(() => withLock(update));

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  // react to navigations and to play/pause (audible flips)
  if ((info.url || info.audible !== undefined) && tab.active) withLock(update);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  withLock(async () => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      await finalize(); // Chrome lost foreground focus
    } else {
      await update();
    }
  });
});

chrome.idle.onStateChanged.addListener(() => withLock(update));

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FLUSH_ALARM) withLock(update);
});

function setup() {
  chrome.idle.setDetectionInterval(IDLE_SECONDS);
  chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(() => {
  setup();
  withLock(update);
});

chrome.runtime.onStartup.addListener(() => {
  setup();
  withLock(update);
});

// Let the popup force a flush so it shows up-to-the-second numbers.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "flush") {
    withLock(update)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true; // async response
  }
});

// ===== Time Tracker - background service worker (MV3) =====
//
// Strategy: time is accrued only when ALL of these are true:
//   1. A Chrome window is focused (Chrome is the foreground app)
//   2. The user is not idle (input within IDLE_SECONDS)
//   3. The active tab is an http/https page
//
// Because MV3 service workers are not persistent, we don't keep a running
// timer in memory. Instead we persist the "current session" (active domain +
// start timestamp) to storage. On every relevant event we finalize the
// previous session (commit elapsed seconds) and, if appropriate, start a new
// one. A 1-minute alarm keeps stored data near-real-time and bounds any
// over-count if the machine sleeps.

const SESSION_KEY = "currentSession"; // { domain, startTime } | null
const DATA_KEY = "timeData";          // { "YYYY-MM-DD": { domain: seconds } }
const FLUSH_ALARM = "flush";
const IDLE_SECONDS = 60;

// A genuine continuous session is chopped into ~60s pieces by the alarm, so any
// single finalize larger than this means the worker/machine was asleep and that
// time should not be fully trusted. We cap each commit to avoid over-counting.
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

async function getActiveDomain() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !tab.url) return null;
  return domainFromUrl(tab.url);
}

async function chromeHasFocus() {
  try {
    const wins = await chrome.windows.getAll();
    return wins.some((w) => w.focused);
  } catch {
    return false;
  }
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
  const idleState = await chrome.idle.queryState(IDLE_SECONDS);
  if (idleState !== "active") return;
  if (!(await chromeHasFocus())) return;
  const domain = await getActiveDomain();
  if (domain) await start(domain);
}

// ---------- event wiring ----------
chrome.tabs.onActivated.addListener(() => withLock(update));

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url && tab.active) withLock(update);
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

chrome.idle.onStateChanged.addListener((state) => {
  withLock(async () => {
    if (state === "active") await update();
    else await finalize();
  });
});

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

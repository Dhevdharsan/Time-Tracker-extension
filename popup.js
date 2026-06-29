// ===== Time Tracker - popup =====

const DAY_MS = 86400000;
let currentPeriod = "week";

// ---------- date helpers ----------
function dateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayKey() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return dateStr(d);
}

function dayDiff(aKey, bKey) {
  const a = new Date(aKey + "T00:00:00");
  const b = new Date(bKey + "T00:00:00");
  return Math.round((b - a) / DAY_MS);
}

function startBoundary(period) {
  if (period === "all") return "0000-00-00";
  const days = period === "today" ? 1 : period === "week" ? 7 : 30;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return dateStr(d);
}

// Number of days to divide by when computing a daily average. Bounded by how
// long data has actually been collected so a 2-day-old install isn't divided
// by 7 or 30.
function divisorDays(period, firstDate) {
  if (period === "today") return 1;
  const windowDays = period === "week" ? 7 : period === "month" ? 30 : Infinity;
  const elapsed = firstDate ? dayDiff(firstDate, todayKey()) + 1 : 1;
  if (period === "all") return Math.max(1, elapsed);
  return Math.max(1, Math.min(windowDays, elapsed));
}

// ---------- formatting ----------
function fmt(sec) {
  sec = Math.round(sec);
  if (sec <= 0) return "0s";
  if (sec < 60) return sec + "s";
  const m = Math.floor(sec / 60);
  if (m < 60) {
    const s = sec % 60;
    return s ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

function colorFor(domain) {
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = (hash * 31 + domain.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue} 58% 52%)`;
}

// ---------- aggregation ----------
function aggregate(timeData, period) {
  const boundary = startBoundary(period);
  const today = todayKey();
  const totals = {};
  let grand = 0;

  const allDates = Object.keys(timeData).sort();
  const firstDate = allDates[0] || null;

  for (const date of allDates) {
    if (date < boundary || date > today) continue;
    for (const [dom, sec] of Object.entries(timeData[date])) {
      totals[dom] = (totals[dom] || 0) + sec;
      grand += sec;
    }
  }

  const divisor = divisorDays(period, firstDate);
  const rows = Object.entries(totals)
    .map(([domain, total]) => ({ domain, total, avg: total / divisor }))
    .sort((a, b) => b.total - a.total);

  return { rows, grand, divisor, firstDate };
}

// ---------- rendering ----------
function render(timeData) {
  const { rows, grand, divisor } = aggregate(timeData, currentPeriod);
  const list = document.getElementById("list");
  const summary = document.getElementById("summary");
  const meta = document.getElementById("meta");
  const perDay = currentPeriod !== "today";

  if (rows.length === 0) {
    summary.innerHTML = "";
    meta.textContent = "";
    list.innerHTML =
      '<div class="empty">No activity recorded yet.<br>Browse a few sites and check back.</div>';
    return;
  }

  summary.innerHTML = perDay
    ? `<span class="total">${fmt(grand / divisor)}</span>
       <span class="sub">avg / day &middot; ${fmt(grand)} total</span>`
    : `<span class="total">${fmt(grand)}</span>
       <span class="sub">total today</span>`;

  const max = rows[0].total || 1;

  list.innerHTML = rows
    .map((r) => {
      const pct = Math.max(2, Math.round((r.total / max) * 100));
      const primary = perDay ? fmt(r.avg) : fmt(r.total);
      const secondary = perDay ? `${fmt(r.total)} total` : "";
      return `
        <div class="row">
          <div class="badge" style="background:${colorFor(r.domain)}">${r.domain[0] || "?"}</div>
          <div class="body">
            <div class="name" title="${r.domain}">${r.domain}</div>
            <div class="bar"><span style="width:${pct}%"></span></div>
          </div>
          <div class="val">
            <div class="primary">${primary}</div>
            ${secondary ? `<div class="secondary">${secondary}</div>` : ""}
          </div>
        </div>`;
    })
    .join("");

  meta.textContent = perDay ? `averaged over ${divisor} day${divisor > 1 ? "s" : ""}` : "";
}

// ---------- load + events ----------
async function load() {
  try {
    await chrome.runtime.sendMessage({ type: "flush" });
  } catch (e) {
    // service worker may be waking up; fall back to stored data
  }
  const { timeData = {} } = await chrome.storage.local.get("timeData");
  render(timeData);
}

document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-period]");
  if (!btn) return;
  currentPeriod = btn.dataset.period;
  for (const b of document.querySelectorAll("#tabs button")) {
    b.classList.toggle("active", b === btn);
  }
  load();
});

document.getElementById("clear").addEventListener("click", async () => {
  if (!confirm("Delete all tracked time data? This cannot be undone.")) return;
  await chrome.storage.local.set({ timeData: {}, currentSession: null });
  load();
});

load();

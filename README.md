# Time Tracker (Chrome extension)

Tracks how much time you actively spend on each website and shows daily averages
for the last week, last month, and all time.

## Install (load into your Chrome profile)

1. Unzip this folder somewhere permanent (don't delete it later — Chrome loads
   the extension from this folder).
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select this `time-tracker` folder.
5. Pin it: click the puzzle-piece icon in the toolbar and pin "Time Tracker".

Click the toolbar icon any time to see your stats.

## What it tracks

Time accrues for the active tab's domain only when **all** of these are true:

- A Chrome window is the focused/foreground app
- You're not idle (some keyboard/mouse input within the last 60 seconds)
- The tab is a normal `http`/`https` page (internal pages like
  `chrome://settings` are ignored)

Data is grouped by **domain** (e.g. `youtube.com`), with `www.` stripped.

## The views

- **Today** – total time per site today.
- **Week** – average time per day over the last 7 days (plus the 7-day total).
- **Month** – average per day over the last 30 days.
- **All time** – average per day since you installed it.

Averages divide by the number of days actually elapsed since first use, so a
brand-new install isn't unfairly divided by 7 or 30.

## Privacy

Everything is stored locally in your browser (`chrome.storage.local`). Nothing
is sent anywhere. Use **Clear data** in the popup to wipe it.

## Notes / limits

- It records the domain, not full URLs or page content.
- Tracking is per Chrome profile (the one the extension is installed in).
- If your computer sleeps, each commit is capped so sleep time isn't counted as
  browsing time.

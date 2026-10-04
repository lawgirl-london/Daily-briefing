# Morning Edition ☀️

A personal daily news app for psychology, medicine, world politics, philosophy,
relationships, professional growth, and food & nutrition.

Every morning at about 6am (UK time), GitHub automatically collects the latest
articles from trusted publishers and updates the app. It's free and needs no
maintenance.

## Using it on your iPhone

1. Open the app's address in **Safari**: `https://lawgirl-london.github.io/daily-briefing/`
2. Tap **Share** (the square with the arrow) → **Add to Home Screen** → **Add**.
3. Open it from your home screen like any other app.

## Changing topics or sources

Everything lives in [`sources.json`](sources.json). Each topic becomes a tab.
To add a source, add a line with its name, RSS feed address, homepage and a short
description. To add a whole new topic, copy one of the topic blocks and give it a
new `id`, `name`, emoji `icon` and `color`.

Edits can be made right here on GitHub (tap the file, then the pencil icon).
The app updates a couple of minutes after you save.

## Running an update by hand

Go to **Actions → Morning briefing → Run workflow**.

## How it works

- `scripts/build_briefing.py` reads each feed, keeps the freshest articles from
  the last 7 days, finds a picture for each one, and writes `site/data/briefing.json`.
- `.github/workflows/daily-briefing.yml` runs that every morning and publishes
  the `site/` folder with GitHub Pages.
- `site/` is the app itself (plain HTML, CSS and JavaScript).

If a source stops working, it's skipped and shows a grey dot on the app's
**Sources** page.

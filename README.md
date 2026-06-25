# 🏆 World Cup 2026 Tracker

A modern, mobile-first tracker for the FIFA World Cup 2026 — group standings &
schedule, a full knockout bracket, and a prediction system that flows your picks
all the way to the Final. All times are shown in **PST** and the header clock
updates **live**.

Built with **React + Vite + Tailwind CSS + lucide-react**.

![tab: Groups & Schedule / Knockouts](https://img.shields.io/badge/React-18-61dafb) ![Vite](https://img.shields.io/badge/Vite-5-646cff) ![Tailwind](https://img.shields.io/badge/Tailwind-3-38bdf8)

## Features

- **Groups** — 12 groups (A–L), 4 teams each, expandable cards with
  live-sortable standings (W-D-L, GD, Pts) and every group match (date, PST time,
  venue, score). Toggle completed matches on/off.
- **Schedule** — every match in kickoff order, grouped by day with **Today /
  Tomorrow** labels, plus an "Up next" banner with a live countdown to the next
  fixture. Each row shows PST time, teams, score (or vs), round, and venue.
  Toggle past days on/off.
- **Knockouts** — Round of 32 → Round of 16 → Quarter-Finals → Semi-Finals →
  Third-Place → Final, each with date, PST time and venue.
- **Predictions** — tap a team to pick the winner of any knockout match. Picks
  **propagate forward** through the bracket (and prune themselves if you change
  an earlier round), are clearly marked, persist in `localStorage`, and roll up
  into a live summary with your predicted champion. Reset any time.
- **Live** — a ticking PST clock; any match inside its kickoff window shows a
  pulsing **LIVE** indicator. The data model already supports real results
  (`match.result`) so a live feed can be wired in later.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build → dist/
npm run preview  # preview the production build
```

## Deploy to GitHub Pages (automatic)

1. Create a new GitHub repo and push this project to the `main` branch.
2. In the repo: **Settings → Pages → Build and deployment → Source → GitHub Actions**.
3. Every push to `main` runs `.github/workflows/deploy.yml`, builds the site, and
   publishes it. Your app goes live at
   `https://<your-username>.github.io/<repo-name>/`.

`vite.config.js` uses `base: './'` (relative paths), so it works under a project
subpath or a custom domain root without further changes.

## Project structure

```
src/
  data.js   # teams, venues, seeded group results + standings, knockout bracket, PST formatters
  App.jsx   # tabs, live clock, groups view, knockout bracket + prediction engine
  main.jsx  # React entry
  index.css # Tailwind + background + animations
```

## Live data

Scores, fixtures, standings, and venues are **real and live** — pulled from
ESPN's public FIFA World Cup feed. No scores are generated; the app only buckets
the live matches into groups / schedule / rounds and computes standings from the
real results. Predictions are made **by the user** (never auto-predicted) and are
graded ✅/❌ against the actual outcome once a match finishes.

The data layer auto-refreshes every ~45s while the tab is open, shows a "last
updated" stamp, and degrades gracefully (loading / error / last-good states).

### Data source — two modes (`src/config.js`)

- **ESPN direct (default, `WC_API = ''`)** — the browser calls ESPN's feed
  directly. Zero infrastructure, free, works on GitHub Pages as-is.
- **Cloudflare Worker (recommended for scale, free tier)** — deploy
  `cloudflare/worker.js` (`wrangler deploy`) and set `WC_API` to its URL. The
  Worker fetches ESPN once, caches the assembled tournament (~30s), serves it to
  everyone, and keeps serving the last-good feed if ESPN blips. This makes the
  app rate-limit-proof no matter how many people open it. Cost: **$0** on the
  Workers free plan.

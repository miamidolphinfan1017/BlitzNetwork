# Blitz Network — Base44 Dev Environment

## Overview
Static HTML NFL fan site ("Blitz Network"). No build system, no backend, no package manager. All pages are standalone `.html` files sharing `style.css` and several JS files (`config.js`, `schedule.js`, `team-sites.js`, `theme-sync.js`).

## Running
```
docker compose -f docker-compose.base44.yml up -d
```
Serves static files via `nginx:alpine` on host port 3000. The repo root is bind-mounted read-only into nginx's document root, so edits appear on browser refresh — no rebuild needed.

## Key files
- `index.html` — landing page
- `style.css` — shared stylesheet (large, ~148KB)
- `config.js` — contains a hardcoded weather API key
- `theme-sync.js` — applies light/dark mode and accent color from localStorage
- `PFPS/`, `Stadiums/`, `WeekPhotos/` — image asset directories

## No external credentials needed
The site is fully static. The weather API key in `config.js` is already hardcoded in the repo.

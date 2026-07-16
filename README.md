# Production Line Staffing App

Single-page app for managing production line staffing: roster with skill depth, per-area slot assignments, break/lunch schedule, task lists, day logging, and save/load of configurations and days.

## Run locally

```bash
npm install
npm run ci
npm run dev
```

Open the URL shown in the terminal (e.g. http://localhost:5173).

## Build

```bash
npm run build
```

Output is in `dist/`. Serve with any static host (Vercel, or `run.bat` / `run.sh` for portable use).

## Running from a thumb drive

See **[PORTABLE.md](PORTABLE.md)**. Build once with Node, copy the folder, run `run.bat` / `run.sh` on the other PC. Use **Download backup** / **Import backup** to move multi-line data between computers.

## Features

- **Roster**: Skill grid (No experience / Training / Trained / Expert). Mark people absent, OT, late, etc.
- **Areas & floats**: Configurable stations and float coverage; leads; break rotations.
- **Automation**: Spread talent / fill remaining / randomize.
- **Local mode**: Data in the browser (`localStorage`). **Download backup** exports the full multi-line `RootState` (older single-line backups still import).
- **Group mode** (optional Supabase): Shared password-protected cloud lines, viewer lock / YEET, **Log the day** + History reports.
- **Staffing View**: Presentation layout + **Copy for Teams** (clipboard).

## Git

- **`.gitignore`** – ignores `node_modules/`, `dist/`, `.env*`, IDE/OS files.
- Put Supabase keys in Vercel / `.env.local`, not in Git (see `.env.example`).

## Deploy on Vercel

1. Push this repo to GitHub.
2. In [Vercel](https://vercel.com), import the repo.
3. Build: `npm run build`, output: `dist`.
4. For Group mode, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

## Supabase (Group / cloud lines)

### 1. Project + migrations

Create a Supabase project, then run SQL from `supabase/migrations/` (or see `supabase/RUN_MIGRATIONS_IN_DASHBOARD.md`), including:

- Cloud lines + data + public list view  
- Version / revisions  
- Viewer presence  
- Day logs (`20260601000000_cloud_line_day_logs.sql`)

### 2. Edge Functions

See `supabase/EDGE_FUNCTIONS_DEPLOY.md`. Deploy at least:

`create-line`, `get-line-state`, `set-line-state`, `delete-line`, `viewer-presence`, `log-day`, `list-day-logs`, `get-day-log`, `delete-day-log`

### 3. Environment

- **App:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- **Optional CORS:** Edge Function secret `ALLOWED_ORIGINS` (comma-separated origins)

### 4. App flow

- **Local / Demo** — browser-only  
- **Group** — create/join a shared line; **Log the day** / **History** for reporting; **Leave line** clears the session  

Shared business constants live under `shared/` (used by the app and Edge Functions).

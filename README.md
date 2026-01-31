# Production Line Staffing App

Single-page app for managing production line staffing: roster with skill depth, per-area slot assignments, break/lunch schedule, task lists, and save/load of configurations and days. roster with skill depth, per-area slot assignments, break/lunch schedule, task lists, and save/load of configurations and days.

## Run locally

```bash
npm install
npm run dev
```

Open the URL shown in the terminal (e.g. http://localhost:5173).

## Build

```bash
npm run build
```

Output is in `dist/`. Serve with any static host.

## Running from a thumb drive

Copy this folder to a USB drive. On the other computer (needs Python or Node):

- **Windows:** Double-click **`run.bat`**
- **Mac/Linux:** Run **`./run.sh`**

See **PORTABLE.md** for full steps (one-time build, what to copy, and moving data between computers).

## Features

- **Roster**: Skill grid (No experience = red, Training = yellow, Trained = green, Expert = plaid). Mark people absent.
- **Areas**: 14.5, Courtyard, Bonding, Testing, Potting, End Of Line, Flip. Per-area staffing % and slots (dropdowns; no double-booking). Add/remove slots. Section task lists.
- **Grand total**: Count of distinct people currently on the line.
- **Day timeline**: 6am–6pm in 1-hour chunks. Breaks 8:30, 2pm, 4pm (15 min, 3 rotations). Lunch 11:30 (30 min, 3 rotations). Per-hour task lists.
- **Notes & documents**: Day notes plus a list of text/links.
- **Automation**: “Spread talent” (assign best fit per area, round-robin); “Randomize” (shuffle assignments).
- **Save config**: Name and save current slot assignment; load from list; export/import JSON.
- **Bank of days**: Save current state (slots, absences, tasks, notes) with date; load or remove from list.

Data is stored in the browser (localStorage). Export config JSON to backup or move assignments; saved days are stored locally in the app.

## Git

The repo is ready to push:

- **`.gitignore`** – ignores `node_modules/`, `dist/`, `.env*`, IDE/OS files. No secrets in the repo.
- **No `.env` files** – when you add Supabase (or other services), put keys in Vercel env vars, not in Git.

## Deploy on Vercel

1. Push this repo to GitHub (or GitLab/Bitbucket).
2. In [Vercel](https://vercel.com), **Add New Project** → import the repo.
3. Vercel will detect Vite; **Build Command**: `npm run build`, **Output Directory**: `dist`. Deploy.
4. The app is static; no server or env vars required for the current localStorage-only setup.

## Supabase (Group / cloud lines)

The app supports **Local / Demo** (data in browser only) and **Group** (shared lines in the cloud, password-protected).

### 1. Supabase project

- Create a project at [Supabase](https://supabase.com).
- Run migrations (from the repo root):
  ```bash
  npx supabase db push
  ```
  Or in the Supabase SQL editor, run the contents of `supabase/migrations/20250128000000_cloud_lines.sql` and `supabase/migrations/20250128100000_cloud_lines_view_security.sql`.

### 2. Edge Functions

Deploy the Edge Functions (create-line, get-line-state, set-line-state):

```bash
npx supabase functions deploy create-line
npx supabase functions deploy get-line-state
npx supabase functions deploy set-line-state
```

### 3. Environment variables

- **Vercel** (or your host) → project → **Settings → Environment Variables**:
  - `VITE_SUPABASE_URL` – Supabase project URL
  - `VITE_SUPABASE_ANON_KEY` – Supabase anon/public key

- **Supabase** → Project Settings → Edge Functions: ensure the project has the default `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (set automatically).

### 4. App flow

- On open, users choose **Local / Demo** (browser-only) or **Group**.
- **Group**: list public lines → **Create a new line** (name + password) or **Join an existing line** (select line + password). Data is saved to the cloud; anyone with the password can join and edit. **Leave line** returns to local and shows the entry screen again on next open (or refresh after leaving).

### 5. Troubleshooting "Edge Function returned a non-2xx status code"

- **Deploy the functions** if you haven’t: `npx supabase login`, then `npx supabase link --project-ref YOUR_REF`, then deploy `create-line`, `get-line-state`, `set-line-state`.
- **Check Edge Function logs**: Supabase Dashboard → **Edge Functions** → select `create-line` → **Logs**. The real error (e.g. missing env, database error) appears there.
- After the next deploy, the app will show the function’s error message in the red banner when create/join fails.

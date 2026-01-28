# Production Line Staffing App

Single-page app for managing production line staffing: roster with skill depth, per-area slot assignments, break/lunch schedule, task lists, and save/load of configurations and days.

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

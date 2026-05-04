# Production Line Staffing App — Project Summary for Recreation

**Purpose:** Give this document (and optionally the repo) to a new Cursor workspace and ask **Gemini 3.1 Pro** to recreate this project from scratch. The goal is to see if a fresh implementation with a newer model produces a cleaner or better result.

---

## 1. What the App Is

A **single-page web app** for managing **production line staffing** in a manufacturing/assembly context. Users maintain a roster of people with per-area skill levels, assign people to area “slots,” manage break/lunch rotations, task lists, and save/load configurations and full “days.” It supports **local-only** use (browser localStorage) and **group/cloud** use (Supabase-backed, password-protected shared lines).

**Core value:** One place to see who is where on the line, skill depth (so critical areas have trained/expert coverage), break/lunch schedule, and day-level notes/documents, with automation (e.g. “spread talent,” “randomize,” “default positions”) and save/load for configs and days.

---

## 2. Tech Stack (Keep This)

- **Frontend:** React 18, TypeScript, Vite 5, ESM.
- **Styling:** Plain CSS with design tokens (CSS variables) in `index.css` — no Tailwind/CSS-in-JS. Tokens for colors, surfaces, spacing, radius, shadows, transitions; font Inter (or system fallback).
- **State:** All in React `useState` (and `useRef` where needed). No Redux/Zustand. State is persisted to localStorage (and optionally to Supabase for “Group” mode).
- **Backend/Cloud:** Supabase (PostgreSQL + Edge Functions). Client uses `@supabase/supabase-js`. Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- **Deploy:** Static build (`npm run build` → `dist/`). Vercel: build command `npm run build`, output directory `dist`, framework Vite. Optional: run from thumb drive via `run.bat` / `run.sh` (serve `dist/` with Python or Node).

---

## 3. Data Model (Critical)

### 3.1 Domain Types

- **SkillLevel:** `'no_experience' | 'training' | 'trained' | 'expert'`. Used per person per area. Visual: no experience = red, training = yellow, trained = green, expert = plaid.
- **Areas:** Fixed set of area IDs: `area_14_5`, `area_courtyard`, `area_bonding`, `area_testing`, `area_potting`, `area_end_of_line`, `area_flip`. Each has display name (e.g. “14.5”, “Courtyard”, “Bonding”) and min/max slot counts. Bonding has default slot labels (Float, 100s, 100s/200s, …).
- **RosterPerson:** `id`, `name`, `absent`, `lead`, `ot`, `otHereToday?`, `late`, `leavingEarly`, `breakPreference?`, `skills: Record<AreaId, SkillLevel>`, `areasWantToLearn?`, `flexedToLineId?`, `defaultAreaId?`, `defaultSlotIndex?`.
- **Slot:** `id`, `personId | null`, `disabled?`, `locked?`. Slots live per area: `SlotsByArea = Record<AreaId, Slot[]>`.
- **Lead slots:** Certain areas have one “lead” slot (e.g. End Of Line, Courtyard, Bonding). Stored as `LeadSlots = Record<string, string | null>` (key = area id or named lead index, value = personId).
- **Tasks:** `TaskItem`: `id`, `text`, `done`. Section tasks per area; schedule tasks per hour.
- **Schedule:** Day timeline 6am–6pm in 1-hour chunks. Each `ScheduleHour`: `hour` (6–17), `taskList`, optional `breakRotation`, `lunchRotation`. Breaks: e.g. 8:30, 2pm, 4pm (15 min, 3 rotations); lunch 11:30 (30 min, 3 rotations).
- **SavedConfig:** Named snapshot of `slots` only (for quick load of assignments).
- **SavedDay:** Full snapshot: date, roster, slots, leadSlots, sectionTasks, schedule, dayNotes, documents, breakSchedules, and optional overrides (juiced/de-juiced areas, break coverage flags, etc.).

### 3.2 App State (Single-Line)

`AppState`: roster, slots, leadSlots, juicedAreas, deJuicedAreas, sectionTasks, schedule, dayNotes, documents, breakSchedules, leadBreakCoverage, areaBreakCoverageEnabled, areaCapacityOverrides, areaNameOverrides, slotLabelsByArea, areaRequiresTrainedOrExpertOverrides, slotBreakCoverageEnabled.

### 3.3 Multi-Line (Current App)

- **RootState:** `currentLineId`, `lines: LineConfig[]`, `lineStates: Record<string, LineState>` where each `LineState` has the same shape as `AppState`. So each line has its own roster and slots.
- **LineConfig:** `id`, `name`, `areas` (id, name, minSlots, maxSlots, defaultSlotLabels?, requiresTrainedOrExpert?), `floatSlots?` (id, name, supportedAreaIds), `leadAreaIds?` or `leadSlotNames?`, `combinedSections` (e.g. [['area_14_5','area_flip']]), `breaksEnabled?`, `breaksScope?` ('line' | 'station'), `breakRotations?` (1–6).
- Two built-in lines: **IC** and **NIC** (same area layout; people can “flex” between lines). Users can also **build custom lines** (add/remove areas, set lead slots, float slots, combined sections).

---

## 4. Features to Implement (Checklist)

1. **Entry screen**  
   - Choose **Local / Demo** (no Supabase) or **Group** (Supabase).  
   - Group: list public lines → **Create line** (name + password) or **Join line** (select + password). Session stored in sessionStorage; “Leave line” clears it.

2. **Roster**  
   - Grid of people with skill columns per area (No experience / Training / Trained / Expert). Mark absent, lead, OT, OT here today, late, leaving early. Add/remove people; OT pool (ot: true, otHereToday: false until marked here). Person profile modal: skills, default position, break preference, areas want to learn. Optional: “flex” person to another line (flexedToLineId).

3. **Areas & slots**  
   - One section per area (or combined section e.g. 14.5 + Flip). Per area: min/max slots; slot dropdowns to assign person (no double-booking). Add/remove slots within min/max. Optional: slot labels (Bonding: Float, 100s, …). Section task lists per area. “Grand total” = distinct people currently on the line.

4. **Lead slots**  
   - One lead per configured area (or named lead positions). Dropdown per lead slot; same no double-booking rule.

5. **Day timeline**  
   - 6am–6pm, 1-hour rows. Break/lunch rotations (e.g. 3 break, 3 lunch). Per-hour task list. Display which rotation is break/lunch in that hour.

6. **Break/lunch scheduling**  
   - After “Spread” or “Randomize,” generate break/lunch assignments so coverage is balanced (respect break preference, skill spread). Per-area or line-wide scope; configurable rotation count. Optional: float slots that cover multiple areas; lead-as-float break coverage; per-slot break coverage toggles.

7. **Automation**  
   - **Spread talent:** Fill slots so each area that “requires trained or expert” gets at least one trained/expert; then fill remaining with best fit; respect locked slots.  
   - **Randomize:** Shuffle assignments (respect locked, eligibility).  
   - **Default positions:** Place people in their default area/slot, then optionally run spread for the rest.  
   - **Juice / de-juice:** Per-area flags that prioritize or deprioritize an area when filling.

8. **Save / load**  
   - **Config:** Save current slots with a name; load from list; export/import JSON.  
   - **Day bank:** Save full state (slots, absences, tasks, notes, etc.) with date; load or remove from list.  
   - **Backup:** Export full state JSON; import to restore.

9. **Line manager**  
   - Switch between lines (IC, NIC, custom). Build new line: wizard to add areas (name, min/max, lead?, default slot labels), float slots (name, supported areas), combined sections. Edit/delete custom lines.

10. **Cloud (Group) mode**  
    - Create line → calls Edge Function `create-line` (name, password, optional rootState). Join → `get-line-state` (lineId, password). All edits sync via `set-line-state`. List lines via Supabase view `cloud_lines_public` (id, name, created_at). Optional: delete line (`delete-line`), share link (URL param `?cloudLine=...`), direct link with password.

11. **Portable / thumb drive**  
    - Build once; copy `dist/`, `run.bat`, `run.sh`, `PORTABLE.md` to USB. `run.bat` / `run.sh` start a small HTTP server (Python or Node) and open browser. Data stays in localStorage; use export/import to move data between machines.

12. **UI/UX**  
    - Collapsible roster; collapsible admin panel; “Configure” mode on area cards (simple vs full). Person profile modal; “Staff the line” wizard (optional); training report (who wants to learn what). Error boundary with tip to clear `staffing-app-state` on crash. Design: clean, card-based layout using CSS variables; no heavy framework look.

---

## 5. Persistence

- **Local:**  
  - `staffing-app-state`: RootState (currentLineId, lines, lineStates) — JSON in localStorage.  
  - `staffing-app-configs`: SavedConfig[].  
  - `staffing-app-days`: SavedDay[].  
  - Debounced save (e.g. 300 ms) on state change. Hydrate on load; migrate legacy single-line or globalRoster if present.

- **Cloud:**  
  - Supabase table `cloud_lines` (id, name, password_hash, created_at).  
  - `cloud_line_data` (line_id, state JSONB, updated_at).  
  - RLS: no direct anon access; access only via Edge Functions with service role.  
  - View `cloud_lines_public`: id, name, created_at for listing.  
  - Edge Functions: `create-line`, `get-line-state`, `set-line-state`, `delete-line`. Password hashed with PBKDF2-SHA256 in `create-line`; verified in get/set/delete.

---

## 6. File / Folder Structure (Target)

- `package.json`: name `staffing-app`, type `module`, scripts dev/build/lint/preview/test. Deps: react, react-dom, @supabase/supabase-js. DevDeps: vite, @vitejs/plugin-react, typescript, eslint, vitest, @testing-library/react, jsdom.
- `vite.config.ts`: react plugin, `base: './'`.
- `tsconfig.json` / `tsconfig.app.json`: strict, ESNext, DOM, noEmit, jsx react-jsx.
- `vercel.json`: buildCommand `npm run build`, outputDirectory `dist`, framework vite.
- `index.html` with root div; `src/main.tsx` (createRoot, ErrorBoundary, App); `src/App.tsx` (all main state and UI); `src/index.css` (tokens + base styles).
- `src/types.ts`: all shared types (SkillLevel, AreaId, RosterPerson, Slot, AppState, LineConfig, LineState, RootState, SavedConfig, SavedDay, etc.).
- `src/data/initialState.ts`: getInitialState(), getEmptyLineState(config), createEmptyPerson, createEmptyOTPerson, default slots/schedule/tasks, normalizeSlotsToCapacity, normalizeSlotsToLineCapacity.
- `src/data/seedRoster.ts`: buildSeedRoster() for demo data (names, random skills, some experts).
- `src/lib/`: persist.ts (load/save root state, configs, days; export/import JSON), fileStorage.ts (save/open file if supported), cloudLines.ts (listCloudLines, createCloudLine, getLineState, setLineState, deleteCloudLine), automation.ts (randomizeAssignments, applyDefaultPositionsThenSpread, fillRemainingAssignments, fillAnchorSlots), breakSchedules.ts (generateBreakSchedules, optimizeFloatBreakRotations), areaConfig.ts, lineConfig.ts (getDefaultICLineConfig, getDefaultNICLineConfig, getAreaIds, getLineSections, getLeadSlotKeys, getEffectiveCapacityForLine, etc.), slots.ts, rosterSort.ts, personLabel.ts, floatCoverage.ts, lineViewRisks.ts, initialState.ts (getHydratedRootState, clearHydrateCache).
- `src/components/`: EntryScreen, LineManager, LineView, RosterGrid, LeadSlotsSection, AreaStaffing, CombinedAreaStaffing, SlotDropdown, UnslottedBank, BreakTable, TaskList, SaveLoadPanel, DayBank, PersonProfileModal, BuildLineWizard, StaffTheLineWizard, TrainingReport, SkillPill.
- `supabase/migrations/`: cloud_lines table + cloud_line_data, cloud_lines_public view; RLS policies; optional security view migration.
- `supabase/functions/`: create-line, get-line-state, set-line-state, delete-line; shared _shared (cors, password hash/verify, supabaseAdmin).
- `run.bat` and `run.sh` for portable run (serve dist/ on port 5173).
- `README.md` and `PORTABLE.md` describing run, build, deploy, Supabase setup, env vars.

---

## 7. Testing

- Vitest + @testing-library/react. Tests for: automation (spread, randomize, eligibility), breakSchedules, slots, floatCoverage; component tests for RosterGrid, AreaStaffing, UnslottedBank where useful. Run: `npm run test`.

---

## 8. Conventions

- No `.env` in repo; use Vercel (or host) env vars for Supabase.  
- `.gitignore`: node_modules, dist, .env*, IDE/OS files.  
- IDs: nanoid-style (e.g. `Math.random().toString(36).slice(2, 11)`).  
- Area “requires trained or expert”: every area except Flip must have at least one trained or expert to run (configurable per line/area via overrides).

---

## 9. Instructions for the New Workspace

**Prompt to use in the new Cursor workspace (with Gemini 3.1 Pro):**

“I want you to recreate a **Production Line Staffing** web app from scratch using the attached project summary (PROJECT_SUMMARY_FOR_RECREATION.md). Use **React 18 + TypeScript + Vite**, plain CSS with design tokens (no Tailwind), and optional Supabase for group/cloud mode. Implement the data model, features, and structure described in the summary. Prefer a clean, maintainable structure: smaller components and lib modules rather than one giant App. Include README and PORTABLE.md, vercel.json, and run.bat/run.sh for portable use. Add a few unit tests for automation and break scheduling. You may use this repo as reference but do not copy-paste; reimplement so the result is clear and consistent.”

Optional: attach this file and/or the repo link so the model can refer to types and edge cases without copying the existing code verbatim.

---

*End of project summary.*

# Run migrations in the Supabase Dashboard

The **dashboard** is Supabase’s web UI: **https://app.supabase.com**

## First-time cloud schema

1. Log in and open your project.
2. In the left sidebar, click **SQL Editor**.
3. Click **New query**.
4. Open **`migrations/run_all_cloud_lines.sql`** from this repo, copy its entire contents, paste into the SQL Editor, and **Run** (Ctrl+Enter).
5. You should see success. That creates tables, RLS policies, and `cloud_lines_public`.

If you **already** ran this once, you can run the same file again (it drops and recreates the `"No anon access"` policies so you do not get error `42710`). You only need the **viewer lock** migration below if that file was never applied via the CLI.

## `version` column and `cloud_line_revisions` (fix `42703 column ... version does not exist`)

If the app or Edge Functions error mentions **`cloud_line_data.version` does not exist**, your database was created from the **old** table definition (before optimistic locking). `CREATE TABLE IF NOT EXISTS` does **not** add new columns to an existing table.

Run **`migrations/20260504100000_cloud_line_versions.sql`** in the SQL Editor the same way (new query → paste full file → Run). It uses `add column if not exists` and is safe to run on newer databases too.

## Viewer lock columns (multi-tab / YEET)

If `cloud_line_data` does not yet have `viewer_session_id` / `viewer_heartbeat_at`, run **`migrations/20260511120000_cloud_line_viewer_presence.sql`** the same way (new query → paste → Run).

## Day logs (Log the day / History & reports)

Run **`migrations/20260601000000_cloud_line_day_logs.sql`** to create `cloud_line_day_logs` and `cloud_line_day_assignments`. Then deploy the `log-day`, `list-day-logs`, and `get-day-log` Edge Functions (see `EDGE_FUNCTIONS_DEPLOY.md`).

Done. Deploy Edge Functions when the app expects them; see README for `ALLOWED_ORIGINS` if you lock down CORS.

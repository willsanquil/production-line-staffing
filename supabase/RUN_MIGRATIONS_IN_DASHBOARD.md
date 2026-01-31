# Run migrations in the Supabase Dashboard

The **dashboard** is Supabase’s web UI: **https://app.supabase.com**

1. Log in and open your project.
2. In the left sidebar, click **SQL Editor**.
3. Click **New query**.
4. Open the file **`migrations/run_all_cloud_lines.sql`** from this repo, copy its entire contents, and paste into the SQL Editor.
5. Click **Run** (or press Ctrl+Enter).
6. You should see “Success. No rows returned.” That means the tables and view were created.

Done. You can leave the SQL Editor; the database is ready for the app and Edge Functions.

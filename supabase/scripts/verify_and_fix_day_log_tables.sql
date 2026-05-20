-- Run in Supabase SQL Editor when "Day log tables are missing" persists.
-- 1) Verifies tables exist  2) Reloads API schema cache

-- Check (should return 2 rows: cloud_line_day_logs, cloud_line_day_assignments)
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('cloud_line_day_logs', 'cloud_line_day_assignments')
order by table_name;

-- If the query above returns 0 rows, run the full migration file:
-- supabase/migrations/20260601000000_cloud_line_day_logs.sql

-- If tables exist but the app still errors, reload the API schema:
notify pgrst, 'reload schema';

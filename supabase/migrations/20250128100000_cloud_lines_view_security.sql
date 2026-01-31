-- Allow anon to list lines via the view only (no direct table access).
-- View runs as definer so it can read cloud_lines without granting anon SELECT on the table.
alter view public.cloud_lines_public set (security_invoker = false);

-- Purge all group (cloud) lines. Run this in Supabase Dashboard → SQL Editor.
-- Deletes from cloud_lines; cloud_line_data is removed automatically (ON DELETE CASCADE).

DELETE FROM public.cloud_lines;

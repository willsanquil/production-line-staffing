-- Cloud lines: public lines that users create (name + password) and join to collaborate.
-- List of lines is public (id, name); password and data are server-only via Edge Functions.

create table if not exists public.cloud_lines (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.cloud_line_data (
  line_id uuid primary key references public.cloud_lines(id) on delete cascade,
  state jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- RLS: no direct anon access (all access via Edge Functions with service role).
alter table public.cloud_lines enable row level security;
alter table public.cloud_line_data enable row level security;

-- Policy: no anon select/insert/update (Edge Functions use service role and bypass RLS when invoked server-side).
create policy "No anon access" on public.cloud_lines for all using (false);
create policy "No anon access" on public.cloud_line_data for all using (false);

-- Optional: allow anon to read only id and name for listing (so client can list without Edge Function).
-- We use a view so password_hash is never exposed.
create or replace view public.cloud_lines_public as
  select id, name, created_at from public.cloud_lines;

-- Allow anon to read the view (so the app can list lines).
grant select on public.cloud_lines_public to anon;

comment on table public.cloud_lines is 'Group lines: name + password; list is public, data is password-protected.';
comment on table public.cloud_line_data is 'State (roster, slots, etc.) per cloud line.';

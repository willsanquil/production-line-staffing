-- Run this entire file once in Supabase Dashboard → SQL Editor → New query → Paste → Run.
-- Cloud lines: public lines that users create (name + password) and join to collaborate.

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

alter table public.cloud_lines enable row level security;
alter table public.cloud_line_data enable row level security;

create policy "No anon access" on public.cloud_lines for all using (false);
create policy "No anon access" on public.cloud_line_data for all using (false);

create or replace view public.cloud_lines_public as
  select id, name, created_at from public.cloud_lines;

alter view public.cloud_lines_public set (security_invoker = false);

grant select on public.cloud_lines_public to anon;

comment on table public.cloud_lines is 'Group lines: name + password; list is public, data is password-protected.';
comment on table public.cloud_line_data is 'State (roster, slots, etc.) per cloud line.';

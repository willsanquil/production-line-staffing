alter table public.cloud_line_data
  add column if not exists version integer not null default 1;

create index if not exists cloud_lines_created_at_idx
  on public.cloud_lines (created_at desc);

create table if not exists public.cloud_line_revisions (
  id bigserial primary key,
  line_id uuid not null references public.cloud_lines(id) on delete cascade,
  version integer not null,
  state jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.cloud_line_revisions enable row level security;

drop policy if exists "No anon access" on public.cloud_line_revisions;
create policy "No anon access" on public.cloud_line_revisions for all using (false);

comment on table public.cloud_line_revisions is 'Append-only cloud line snapshots for recovery and audit.';

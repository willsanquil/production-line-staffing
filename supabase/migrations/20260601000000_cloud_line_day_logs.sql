-- End-of-day staffing logs for reporting (station placement + break rotations).

create table if not exists public.cloud_line_day_logs (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.cloud_lines(id) on delete cascade,
  work_date date not null,
  logged_at timestamptz not null default now(),
  logged_by text null,
  shift_hours numeric not null default 11.5,
  snapshot jsonb not null default '{}',
  notes text null,
  unique (line_id, work_date)
);

create table if not exists public.cloud_line_day_assignments (
  id bigserial primary key,
  log_id uuid not null references public.cloud_line_day_logs(id) on delete cascade,
  line_id uuid not null references public.cloud_lines(id) on delete cascade,
  work_date date not null,
  person_id text not null,
  person_name text not null,
  assignment_type text not null check (assignment_type in ('primary', 'lead', 'float_cover')),
  area_id text not null,
  area_name text not null,
  slot_index integer null,
  slot_label text null,
  break_rotation integer null,
  lunch_rotation integer null,
  skill_level text null
);

create index if not exists cloud_line_day_logs_line_date_idx
  on public.cloud_line_day_logs (line_id, work_date desc);

create index if not exists cloud_line_day_assignments_line_date_idx
  on public.cloud_line_day_assignments (line_id, work_date desc);

create index if not exists cloud_line_day_assignments_line_area_date_idx
  on public.cloud_line_day_assignments (line_id, area_id, work_date desc);

create index if not exists cloud_line_day_assignments_line_person_date_idx
  on public.cloud_line_day_assignments (line_id, person_id, work_date desc);

alter table public.cloud_line_day_logs enable row level security;
alter table public.cloud_line_day_assignments enable row level security;

drop policy if exists "No anon access" on public.cloud_line_day_logs;
drop policy if exists "No anon access" on public.cloud_line_day_assignments;

create policy "No anon access" on public.cloud_line_day_logs for all using (false);
create policy "No anon access" on public.cloud_line_day_assignments for all using (false);

comment on table public.cloud_line_day_logs is 'One logged snapshot per cloud line per calendar work day.';
comment on table public.cloud_line_day_assignments is 'Normalized person–station facts for analytics (primary slot + leads).';

-- Single active editor per cloud line: heartbeat + session id for takeover / idle expiry.

alter table public.cloud_line_data
  add column if not exists viewer_session_id uuid null,
  add column if not exists viewer_heartbeat_at timestamptz null;

comment on column public.cloud_line_data.viewer_session_id is 'Browser tab session holding edit lock; null = no active editor.';
comment on column public.cloud_line_data.viewer_heartbeat_at is 'Last heartbeat from editor; stale after ~10 min allows another client to claim.';

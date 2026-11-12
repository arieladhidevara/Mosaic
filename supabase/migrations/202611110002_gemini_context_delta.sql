-- Compact, server-owned context used to send only changed workspace data to Gemini.
alter table public.mosaic_ai_sessions
  add column if not exists context_state jsonb not null default '{}'::jsonb
  check (jsonb_typeof(context_state)='object');
-- The table already has RLS enabled and is service_role-only.

-- Private Design Copilot memory. Apply once to mozAI's production Supabase project.
-- Server-only: no browser role may read or update Gemini interaction IDs or memory.
begin;
create unique index if not exists mosaic_projects_id_owner_environment
  on public.mosaic_projects(id,user_id,environment);

create table if not exists public.mosaic_ai_sessions (
  project_id uuid primary key,
  user_id uuid not null,
  environment text not null check (environment in ('development','preview','production')),
  interaction_id text not null check (length(interaction_id) between 5 and 250),
  design_memory text not null default '' check (length(design_memory)<=1200),
  last_target_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(last_target_ids)='array'),
  updated_at timestamptz not null default now(),
  foreign key (project_id,user_id,environment)
    references public.mosaic_projects(id,user_id,environment) on delete cascade
);
create index if not exists mosaic_ai_sessions_owner on public.mosaic_ai_sessions(user_id,environment);
alter table public.mosaic_ai_sessions enable row level security;
revoke all on public.mosaic_ai_sessions from public,anon,authenticated;
grant select,insert,update,delete on public.mosaic_ai_sessions to service_role;
commit;

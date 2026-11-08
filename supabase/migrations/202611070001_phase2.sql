-- Phase 2 foundation. Run in the intended Supabase project's SQL editor.
-- Application data is server-only; clients never receive a service key.
begin;
create table if not exists public.mosaic_invitations (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id),
  environment text not null check (environment in ('development','preview','production')),
  token_hash text not null unique check (length(token_hash)=64),
  label text not null default '', email text,
  max_uses integer not null default 1 check (max_uses between 1 and 100),
  redemption_count integer not null default 0 check (redemption_count>=0),
  expires_at timestamptz not null, revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.mosaic_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  environment text not null check (environment in ('development','preview','production')),
  email text not null, role text not null default 'user' check (role in ('user','admin')),
  status text not null default 'active' check (status in ('active','suspended')),
  invitation_id uuid references public.mosaic_invitations(id),
  created_at timestamptz not null default now(), last_active_at timestamptz,
  primary key (user_id,environment)
);
create table if not exists public.mosaic_redemptions (
  invitation_id uuid not null references public.mosaic_invitations(id),
  user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (invitation_id,user_id)
);
create table if not exists public.mosaic_projects (
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  environment text not null check (environment in ('development','preview','production')),
  created_at timestamptz not null default now(),
  foreign key (user_id,environment) references public.mosaic_members(user_id,environment)
);
create table if not exists public.mosaic_events (
  id uuid primary key, user_id uuid not null, project_id uuid references public.mosaic_projects(id),
  environment text not null check (environment in ('development','preview','production')),
  type text not null check (type in ('session_started','base_uploaded','master_uploaded','project_opened','project_saved','selection_created','image_exported')),
  created_at timestamptz not null default now(),
  foreign key (user_id,environment) references public.mosaic_members(user_id,environment)
);
create table if not exists public.mosaic_generations (
  id uuid primary key, user_id uuid not null, project_id uuid references public.mosaic_projects(id),
  environment text not null check (environment in ('development','preview','production')),
  operation text not null check (operation in ('master','edit','harmonize')),
  model text not null, quality text not null check (quality in ('low','medium','high')),
  preserve_original_geometry boolean not null,
  status text not null check (status in ('pending','success','failed')),
  duration_ms integer, input_tokens bigint, output_tokens bigint, total_tokens bigint,
  estimated_cost_usd numeric, error_code text,
  created_at timestamptz not null default now(),
  foreign key (user_id,environment) references public.mosaic_members(user_id,environment)
);
create index if not exists mosaic_events_environment_date on public.mosaic_events(environment,created_at desc);
create index if not exists mosaic_events_user_project on public.mosaic_events(user_id,project_id,created_at desc);
create index if not exists mosaic_generations_environment_date on public.mosaic_generations(environment,created_at desc);
create index if not exists mosaic_generations_user_project on public.mosaic_generations(user_id,project_id,created_at desc);
create index if not exists mosaic_projects_owner on public.mosaic_projects(user_id,environment);
create index if not exists mosaic_invitations_environment_date on public.mosaic_invitations(environment,created_at desc);

alter table public.mosaic_members enable row level security;
alter table public.mosaic_invitations enable row level security;
alter table public.mosaic_redemptions enable row level security;
alter table public.mosaic_projects enable row level security;
alter table public.mosaic_events enable row level security;
alter table public.mosaic_generations enable row level security;
revoke all on public.mosaic_members,public.mosaic_invitations,public.mosaic_redemptions,public.mosaic_projects,public.mosaic_events,public.mosaic_generations from public,anon,authenticated;
grant select,insert,update,delete on public.mosaic_members,public.mosaic_invitations,public.mosaic_redemptions,public.mosaic_projects,public.mosaic_events,public.mosaic_generations to service_role;

create or replace function public.mosaic_check_invitation(p_token_hash text,p_email text,p_environment text)
returns boolean language sql security definer set search_path='' as $$
  select exists(select 1 from public.mosaic_invitations i where i.token_hash=p_token_hash and i.environment=p_environment
    and i.revoked_at is null and i.expires_at>now() and i.redemption_count<i.max_uses
    and (i.email is null or lower(i.email)=lower(p_email)));
$$;

create or replace function public.mosaic_redeem_invitation(p_token_hash text,p_user_id uuid,p_environment text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation public.mosaic_invitations; member public.mosaic_members; verified_email text;
begin
  select u.email into verified_email from auth.users u where u.id=p_user_id and u.email_confirmed_at is not null;
  if verified_email is null then return null; end if;
  -- Lock the invitation before checking capacity. Concurrent redemptions cannot exceed max_uses.
  select * into invitation from public.mosaic_invitations i where i.token_hash=p_token_hash and i.environment=p_environment for update;
  if invitation.id is null or invitation.revoked_at is not null or invitation.expires_at<=now()
    or (invitation.email is not null and lower(invitation.email)<>lower(verified_email)) then return null; end if;
  select * into member from public.mosaic_members m where m.user_id=p_user_id and m.environment=p_environment;
  if member.user_id is not null then return to_jsonb(member); end if;
  if invitation.redemption_count>=invitation.max_uses then return null; end if;
  insert into public.mosaic_members(user_id,environment,email,invitation_id) values(p_user_id,p_environment,verified_email,invitation.id)
    on conflict(user_id,environment) do nothing;
  if not found then
    select * into member from public.mosaic_members m where m.user_id=p_user_id and m.environment=p_environment;
    return to_jsonb(member);
  end if;
  insert into public.mosaic_redemptions(invitation_id,user_id) values(invitation.id,p_user_id) on conflict do nothing;
  if found then update public.mosaic_invitations set redemption_count=redemption_count+1 where id=invitation.id; end if;
  select * into member from public.mosaic_members m where m.user_id=p_user_id and m.environment=p_environment;
  return to_jsonb(member);
end;
$$;

create or replace function public.mosaic_record_event(p_id uuid,p_user_id uuid,p_environment text,p_project_id uuid,p_type text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.mosaic_members m where m.user_id=p_user_id and m.environment=p_environment and m.status='active') then raise exception 'Access denied'; end if;
  if p_project_id is not null and not exists(select 1 from public.mosaic_projects p where p.id=p_project_id and p.user_id=p_user_id and p.environment=p_environment) then raise exception 'Project access denied'; end if;
  insert into public.mosaic_events(id,user_id,environment,project_id,type) values(p_id,p_user_id,p_environment,p_project_id,p_type) on conflict(id) do nothing;
  update public.mosaic_members set last_active_at=now() where user_id=p_user_id and environment=p_environment;
end;
$$;

create or replace function public.mosaic_admin_overview(p_environment text)
returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object(
    'users',(select count(*) from public.mosaic_members where environment=p_environment),
    'projects',(select count(*) from public.mosaic_projects where environment=p_environment),
    'exports',(select count(*) from public.mosaic_events where environment=p_environment and type='image_exported'),
    'generations',count(*),'successful_generations',count(*) filter(where status='success'),
    'failed_generations',count(*) filter(where status='failed'),
    'total_tokens',sum(total_tokens),'usage_records',count(total_tokens),
    'average_duration_ms',round(avg(duration_ms) filter(where status='success')))
  from public.mosaic_generations where environment=p_environment;
$$;

-- Operator-only bootstrap: user must already exist and have confirmed email.
create or replace function public.mosaic_bootstrap_admin(p_email text,p_environment text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user_id uuid; verified_email text;
begin
  select u.id,u.email into v_user_id,verified_email from auth.users u where lower(u.email)=lower(p_email) and u.email_confirmed_at is not null;
  if v_user_id is null then raise exception 'Create and confirm this user in Supabase Auth first'; end if;
  insert into public.mosaic_members(user_id,environment,email,role) values(v_user_id,p_environment,verified_email,'admin')
    on conflict(user_id,environment) do update set role='admin',status='active';
  return v_user_id;
end;
$$;
revoke all on function public.mosaic_check_invitation(text,text,text),public.mosaic_redeem_invitation(text,uuid,text),public.mosaic_record_event(uuid,uuid,text,uuid,text),public.mosaic_admin_overview(text),public.mosaic_bootstrap_admin(text,text) from public,anon,authenticated;
grant execute on function public.mosaic_check_invitation(text,text,text),public.mosaic_redeem_invitation(text,uuid,text),public.mosaic_record_event(uuid,uuid,text,uuid,text),public.mosaic_admin_overview(text),public.mosaic_bootstrap_admin(text,text) to service_role;
commit;

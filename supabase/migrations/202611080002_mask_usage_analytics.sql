-- Add metadata-only tool events and server-only aggregate analytics.
begin;
alter table public.mosaic_events drop constraint if exists mosaic_events_type_check;
alter table public.mosaic_events add constraint mosaic_events_type_check check(type in (
  'session_started','base_uploaded','master_uploaded','project_opened','project_saved','selection_created','image_exported',
  'wand_used','auto_create_used','mask_edited','selection_simplified'
));
create index if not exists mosaic_events_environment_user_date on public.mosaic_events(environment,user_id,created_at);
create index if not exists mosaic_generations_environment_user_date on public.mosaic_generations(environment,user_id,created_at);

create or replace function public.mosaic_usage_summary(p_environment text,p_user_id uuid default null,p_project_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
  with generations as (
    select * from public.mosaic_generations where environment=p_environment
      and (p_user_id is null or user_id=p_user_id) and (p_project_id is null or project_id=p_project_id)
  ), events as (
    select * from public.mosaic_events where environment=p_environment
      and (p_user_id is null or user_id=p_user_id) and (p_project_id is null or project_id=p_project_id)
  )
  select (select jsonb_build_object(
    'edits',count(*),'masking',count(*) filter(where operation='edit'),
    'master',count(*) filter(where operation='master'),'harmonize',count(*) filter(where operation='harmonize'),
    'success',count(*) filter(where status='success'),'failed',count(*) filter(where status='failed'),
    'pending',count(*) filter(where status='pending'),'total_tokens',sum(total_tokens),'token_records',count(total_tokens),
    'estimated_cost_usd',sum(estimated_cost_usd),'cost_records',count(estimated_cost_usd)) from generations)
  || (select jsonb_build_object(
    'wand',count(*) filter(where type='wand_used'),'auto_create',count(*) filter(where type='auto_create_used'),
    'mask_edits',count(*) filter(where type='mask_edited'),'selections',count(*) filter(where type='selection_created'),
    'simplified',count(*) filter(where type='selection_simplified'),'exports',count(*) filter(where type='image_exported')) from events)
  || jsonb_build_object(
    'users',(select count(*) from public.mosaic_members where environment=p_environment and (p_user_id is null or user_id=p_user_id)),
    'projects',(select count(*) from public.mosaic_projects where environment=p_environment
      and (p_user_id is null or user_id=p_user_id) and (p_project_id is null or id=p_project_id)));
$$;

create or replace function public.mosaic_admin_analytics(p_environment text,p_user_id uuid default null,p_project_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
  with days as (
    select generate_series(
      (current_timestamp at time zone 'UTC')::date-29,
      (current_timestamp at time zone 'UTC')::date,interval '1 day')::date as day
  ), generations as (
    select (created_at at time zone 'UTC')::date as day,
      count(*) as edits,count(*) filter(where operation='edit') as masking,
      count(*) filter(where operation='master') as master,count(*) filter(where operation='harmonize') as harmonize,
      sum(estimated_cost_usd) as estimated_cost_usd,count(estimated_cost_usd) as cost_records
    from public.mosaic_generations where environment=p_environment
      and (p_user_id is null or user_id=p_user_id) and (p_project_id is null or project_id=p_project_id)
      and created_at >= (((current_timestamp at time zone 'UTC')::date-29)::timestamp at time zone 'UTC')
    group by 1
  ), events as (
    select (created_at at time zone 'UTC')::date as day,
      count(*) filter(where type='wand_used') as wand,count(*) filter(where type='auto_create_used') as auto_create,
      count(*) filter(where type='mask_edited') as mask_edits,count(*) filter(where type='selection_created') as selections
    from public.mosaic_events where environment=p_environment
      and (p_user_id is null or user_id=p_user_id) and (p_project_id is null or project_id=p_project_id)
      and created_at >= (((current_timestamp at time zone 'UTC')::date-29)::timestamp at time zone 'UTC')
    group by 1
  )
  select jsonb_build_object(
    'summary',public.mosaic_usage_summary(p_environment,p_user_id,p_project_id),
    'daily',(select coalesce(jsonb_agg(jsonb_build_object(
      'date',d.day,'edits',coalesce(g.edits,0),'masking',coalesce(g.masking,0),
      'master',coalesce(g.master,0),'harmonize',coalesce(g.harmonize,0),
      'wand',coalesce(e.wand,0),'auto_create',coalesce(e.auto_create,0),
      'mask_edits',coalesce(e.mask_edits,0),'selections',coalesce(e.selections,0),
      'estimated_cost_usd',g.estimated_cost_usd,'cost_records',coalesce(g.cost_records,0)) order by d.day),'[]'::jsonb)
      from days d left join generations g using(day) left join events e using(day)),
    'users',(select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'email',m.email,'role',m.role,'status',m.status)
      || public.mosaic_usage_summary(p_environment,m.user_id,p_project_id) order by m.created_at desc),'[]'::jsonb)
      from public.mosaic_members m where m.environment=p_environment and (p_user_id is null or m.user_id=p_user_id))
  );
$$;
revoke all on function public.mosaic_usage_summary(text,uuid,uuid),public.mosaic_admin_analytics(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.mosaic_usage_summary(text,uuid,uuid),public.mosaic_admin_analytics(text,uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;

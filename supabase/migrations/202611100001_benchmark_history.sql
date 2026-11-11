-- Admin-only object-map benchmark metadata. No images, prompts, or credentials.
begin;
create table if not exists public.mosaic_benchmarks (
  id uuid primary key,
  run_id uuid not null,
  user_id uuid not null,
  environment text not null check(environment in ('development','preview','production')),
  model text not null check(model in ('gpt-image-1.5','gpt-image-2','gpt-image-2.5-sunburst','gpt-image-2.6-sunburst')),
  quality text not null check(quality in ('low','medium','high')),
  width integer not null check(width between 1 and 4096),
  height integer not null check(height between 1 and 4096),
  duration_ms integer not null check(duration_ms>=0),
  input_tokens bigint, image_input_tokens bigint, text_input_tokens bigint,
  output_tokens bigint, total_tokens bigint,
  image_input_cost_usd numeric, text_input_cost_usd numeric, image_output_cost_usd numeric,
  estimated_cost_usd numeric,
  created_at timestamptz not null default now(),
  foreign key (user_id,environment) references public.mosaic_members(user_id,environment)
);
create index if not exists mosaic_benchmarks_user_recent on public.mosaic_benchmarks(environment,user_id,created_at desc);
alter table public.mosaic_benchmarks enable row level security;
revoke all on public.mosaic_benchmarks from public,anon,authenticated;
grant select,insert on public.mosaic_benchmarks to service_role;
notify pgrst,'reload schema';
commit;

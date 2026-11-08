-- Server-encrypted OpenAI BYOK credentials. Postgres never holds plaintext keys.
create table if not exists public.mosaic_api_keys (
  user_id uuid not null,
  environment text not null check (environment in ('development','preview','production')),
  encrypted_key text not null check (length(encrypted_key) between 36 and 1024),
  key_hint text not null check (key_hint ~ '^[A-Za-z0-9_-]{4}$'),
  updated_at timestamptz not null default now(),
  primary key(user_id,environment),
  foreign key(user_id,environment) references public.mosaic_members(user_id,environment) on delete cascade
);
alter table public.mosaic_api_keys enable row level security;
revoke all on table public.mosaic_api_keys from public,anon,authenticated;
grant select,insert,update,delete on table public.mosaic_api_keys to service_role;
comment on table public.mosaic_api_keys is 'AES-256-GCM encrypted BYOK secrets; service role only.';

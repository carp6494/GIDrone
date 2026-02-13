create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  lat double precision,
  lng double precision,
  region text,
  notes text,
  photo_url text,
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sites_user_id_idx on public.sites (user_id);
create index if not exists sites_region_idx on public.sites (region);

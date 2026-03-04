create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  site_number text,
  site_name text,
  city text,
  county text,
  state text,
  latitude double precision,
  longitude double precision,
  structure_type text,
  notes text,
  photo_url text,
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sites_user_id_idx on public.sites (user_id);
create index if not exists sites_state_idx on public.sites (state);
create index if not exists sites_lat_lon_idx on public.sites (latitude, longitude);
create unique index if not exists sites_user_site_number_idx on public.sites (user_id, site_number);

alter table public.sites enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'sites'
      and policyname = 'sites_select_own'
  ) then
    create policy sites_select_own
      on public.sites
      for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'sites'
      and policyname = 'sites_insert_own'
  ) then
    create policy sites_insert_own
      on public.sites
      for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'sites'
      and policyname = 'sites_update_own'
  ) then
    create policy sites_update_own
      on public.sites
      for update
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'sites'
      and policyname = 'sites_delete_own'
  ) then
    create policy sites_delete_own
      on public.sites
      for delete
      using (auth.uid() = user_id);
  end if;
end
$$;

notify pgrst, 'reload schema';

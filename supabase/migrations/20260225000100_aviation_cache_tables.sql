create table if not exists public.api_cache (
  cache_key text primary key,
  payload jsonb not null,
  status_code integer not null default 200,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists api_cache_expires_at_idx on public.api_cache (expires_at);

create table if not exists public.stations_index (
  icao_id text primary key,
  name text,
  country text not null,
  state text,
  lat double precision not null,
  lon double precision not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stations_index_country_idx on public.stations_index (country);
create index if not exists stations_index_updated_at_idx on public.stations_index (updated_at);
create index if not exists stations_index_lat_lon_idx on public.stations_index (lat, lon);


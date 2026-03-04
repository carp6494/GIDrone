create table if not exists public.notam_feed (
  id text primary key,
  notam_id text not null,
  facility_icao text,
  type text,
  category text,
  subtype text,
  description text,
  state text,
  location text,
  starts_at timestamptz,
  ends_at timestamptz,
  raw_text text,
  source text not null default 'swift-scds',
  payload jsonb not null default '{}'::jsonb,
  ingested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notam_feed_facility_icao_idx on public.notam_feed (facility_icao);
create index if not exists notam_feed_notam_id_idx on public.notam_feed (notam_id);
create index if not exists notam_feed_starts_at_idx on public.notam_feed (starts_at);
create index if not exists notam_feed_ends_at_idx on public.notam_feed (ends_at);
create index if not exists notam_feed_updated_at_idx on public.notam_feed (updated_at);

notify pgrst, 'reload schema';

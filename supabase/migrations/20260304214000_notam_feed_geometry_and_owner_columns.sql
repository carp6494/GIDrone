alter table public.notam_feed
  add column if not exists geom_type text,
  add column if not exists center_lat double precision,
  add column if not exists center_lon double precision,
  add column if not exists radius_nm double precision,
  add column if not exists feature_lat double precision,
  add column if not exists feature_lon double precision,
  add column if not exists geojson jsonb,
  add column if not exists facility_code text,
  add column if not exists issued_at timestamptz,
  add column if not exists account_id text,
  add column if not exists affected_fir text,
  add column if not exists selection_code text,
  add column if not exists traffic text,
  add column if not exists purpose text,
  add column if not exists scope text,
  add column if not exists minimum_fl text,
  add column if not exists maximum_fl text,
  add column if not exists structure_type text,
  add column if not exists structure_designator text,
  add column if not exists structure_asr text,
  add column if not exists structure_height_ft double precision,
  add column if not exists structure_elevation_ft double precision,
  add column if not exists lighting_present boolean,
  add column if not exists lighting_status text,
  add column if not exists owner_name text,
  add column if not exists owner_source text,
  add column if not exists owner_last_checked_at timestamptz;

create index if not exists notam_feed_geom_type_idx on public.notam_feed (geom_type);
create index if not exists notam_feed_structure_asr_idx on public.notam_feed (structure_asr);
create index if not exists notam_feed_owner_name_idx on public.notam_feed (owner_name);

notify pgrst, 'reload schema';

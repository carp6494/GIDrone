-- FAA Digital Obstacle File (DOF) — all registered US man-made obstructions
CREATE TABLE IF NOT EXISTS public.obstructions (
  id text PRIMARY KEY,                  -- OAS number "XX-NNNNNN"
  oas_number text NOT NULL,
  verification_status text,             -- O=verified, U=unverified
  country text,
  state text,
  city text,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  obstacle_type text,                   -- TOWER, BLDG, STACK, POLE, etc.
  quantity integer,
  agl_height_ft double precision,       -- height above ground level
  amsl_height_ft double precision,      -- height above mean sea level
  lighting_code text,                   -- R=red, D=dual, C=catenary, F=flood, etc.
  horizontal_accuracy text,
  vertical_accuracy text,
  mark_indicator text,                  -- P=painted, F=flag, etc.
  faa_study_number text,
  action_code text,                     -- A=add, C=change, D=dismantle
  julian_date text,
  asrn text,                            -- FCC Antenna Structure Registration Number
  owner_name text,                      -- populated via FCC ASR lookup (Phase 2)
  owner_source text,
  owner_last_checked_at timestamptz,
  source text NOT NULL DEFAULT 'faa-dof',
  ingested_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Spatial index (critical for bounding-box queries)
CREATE INDEX IF NOT EXISTS obstructions_lat_lon_idx ON public.obstructions (lat, lon);

-- Filter / sort indexes
CREATE INDEX IF NOT EXISTS obstructions_obstacle_type_idx ON public.obstructions (obstacle_type);
CREATE INDEX IF NOT EXISTS obstructions_state_idx ON public.obstructions (state);
CREATE INDEX IF NOT EXISTS obstructions_agl_height_ft_idx ON public.obstructions (agl_height_ft);
CREATE INDEX IF NOT EXISTS obstructions_lighting_code_idx ON public.obstructions (lighting_code);
CREATE INDEX IF NOT EXISTS obstructions_asrn_idx ON public.obstructions (asrn);
CREATE INDEX IF NOT EXISTS obstructions_updated_at_idx ON public.obstructions (updated_at);

-- RLS: enable + public read
ALTER TABLE public.obstructions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "obstructions_select_all" ON public.obstructions
  FOR SELECT USING (true);

NOTIFY pgrst, 'reload schema';

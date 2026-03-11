-- Enable RLS on all 3 flagged tables
ALTER TABLE public.notam_feed ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stations_index ENABLE ROW LEVEL SECURITY;

-- Allow public read access (anon + authenticated)
CREATE POLICY "notam_feed_select_all" ON public.notam_feed
  FOR SELECT USING (true);

CREATE POLICY "api_cache_select_all" ON public.api_cache
  FOR SELECT USING (true);

CREATE POLICY "stations_index_select_all" ON public.stations_index
  FOR SELECT USING (true);

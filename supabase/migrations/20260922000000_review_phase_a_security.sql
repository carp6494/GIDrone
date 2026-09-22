-- Review Phase A security fixes (docs/superpowers/reviews/2026-09-22-findings.md #8, #17)

-- #8: rls_auto_enable() is SECURITY DEFINER and was callable by any API client
-- via /rest/v1/rpc/rls_auto_enable. Only the owner / service role should run it.
revoke execute on function public.rls_auto_enable() from anon, authenticated, public;

-- #17: api_cache is readable by anon (needed for cached upstream payloads), but
-- notam-sync stores the live NMS-API OAuth bearer token there under
-- cache_key 'nms-api:oauth-token'. Hide secret-bearing rows from API clients.
-- Edge Functions read the cache with the service role, which bypasses RLS,
-- so notam-sync keeps working unchanged.
alter policy api_cache_select_all on public.api_cache
  using (cache_key not like 'nms-api:%');

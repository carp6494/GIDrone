create or replace function public.prune_notam_feed(
  retain_expired_hours integer default 48,
  retain_stale_hours integer default 336
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  deleted_count integer := 0;
begin
  delete from public.notam_feed
  where
    (ends_at is not null and ends_at < now() - make_interval(hours => greatest(retain_expired_hours, 1)))
    or
    (ends_at is null and updated_at < now() - make_interval(hours => greatest(retain_stale_hours, 1)));

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

notify pgrst, 'reload schema';

-- One-time cleanup for malformed rows created before the AIXM parser fix.
delete from public.notam_feed
where
  id like 'Event_%'
  or id like 'TimeInstantType_%'
  or id like 'RunwayDirection_%'
  or id like 'VerticalStructure%'
  or id like 'RWYDIR01_%'
  or id like 'RS01_%'
  or id like 'NAV01_%';

-- Optional one-time purge of non-U.S. rows while SWIFT_ALLOW_NON_US=false.
delete from public.notam_feed
where facility_icao is not null
  and not (
    facility_icao like 'K%'
    or facility_icao like 'PA%'
    or facility_icao like 'PF%'
    or facility_icao like 'PO%'
    or facility_icao like 'PP%'
    or facility_icao like 'PH%'
    or facility_icao like 'PG%'
    or facility_icao like 'PJ%'
    or facility_icao like 'PK%'
    or facility_icao like 'PM%'
    or facility_icao like 'PT%'
    or facility_icao like 'PW%'
    or facility_icao like 'TJ%'
    or facility_icao like 'TI%'
    or facility_icao like 'NS%'
  );

-- Ongoing retention cleanup (same defaults used by the ingest function).
-- Returns the number of rows removed.
select public.prune_notam_feed();

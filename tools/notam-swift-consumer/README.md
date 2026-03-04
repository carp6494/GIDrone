# SWIFT NOTAM Consumer

This is the external long-running consumer for the FAA SWIFT / SCDS NOTAM queue.

It connects to the SWIFT queue shown in the subscription details, receives queue messages, performs first-pass NOTAM normalization (including geometry and obstruction metadata when available), and posts each message into the existing Supabase `notam-ingest` Edge Function.

## Why this exists

The SWIFT Portal subscription is a persistent queue subscription. Supabase Edge Functions are request/response and are not the right place to hold an always-on JMS queue connection.

The architecture is:

1. SWIFT queue consumer (this tool)
2. `notam-ingest` Edge Function
3. `public.notam_feed`
4. `notam` Edge Function
5. Aviation tab UI

## Current state

This consumer now handles the live feed path and stores normalized rows in `public.notam_feed`.

Current normalization includes:

- real NOTAM-style IDs and improved facility extraction
- U.S.-only persistence by default (`SWIFT_ALLOW_NON_US=false`)
- point / circle geometry derivation where coordinates are available
- radius, center, and feature coordinates
- obstruction hints such as structure type, height, lighting, and ASR extraction
- owner placeholders only; owner enrichment runs separately through `tools/notam-owner-enricher`

It still uses pragmatic heuristic parsing because SWIFT payload variants can differ. Tighten `index.mjs` further if you capture a feed variant that exposes cleaner structured fields.

## Environment mapping

Map the values from the SWIFT Portal subscription details page as follows:

- `JMS Connection URL` -> `SWIFT_PROVIDER_URL`
- `Queue Name` -> `SWIFT_QUEUE`
- `Connection Factory` -> `SWIFT_CONNECTION_FACTORY`
- `Connection Username` -> `SWIFT_USERNAME`
- `Connection Password` -> `SWIFT_PASSWORD`
- `Message VPN` -> `SWIFT_VPN`

Supabase values:

- `NOTAM_INGEST_URL` -> your deployed `notam-ingest` function URL
- `NOTAM_INGEST_TOKEN` -> the same secret configured in Supabase for the `notam-ingest` function

Filter values:

- `SWIFT_ALLOW_NON_US=false` -> store U.S. / domestic FAA rows only (recommended default)
- `SWIFT_ALLOW_NON_US=true` -> keep the full global feed for future higher-tier use

## Setup

1. From this folder, install dependencies:

```powershell
npm install
```

2. Copy `.env.example` values into your shell session or a local `.env` loader of your choice.

3. In the main repo, make sure you have already:

- applied `supabase/migrations/20260304143000_notam_feed_table.sql`
- applied `supabase/migrations/20260304214000_notam_feed_geometry_and_owner_columns.sql`
- set the `NOTAM_INGEST_TOKEN` Supabase secret
- optionally applied `supabase/migrations/20260304201500_notam_retention_function.sql`
- deployed `notam` and `notam-ingest`

4. Start the consumer:

```powershell
npm start
```

## Important limitations

- The `Connection Factory` value is documented for parity with the SWIFT portal fields, but the Solace JavaScript API does not use it directly.
- The consumer defaults to U.S.-only persistence so the database stays focused on current needs. Set `SWIFT_ALLOW_NON_US=true` later if you want the full global feed for subscription tiers.
- Retention is handled by the database helper `public.prune_notam_feed()` and the maintenance script in `supabase/sql/notam_maintenance.sql`.
- Tower owner lookup is intentionally not part of the queue loop. Run `tools/notam-owner-enricher` separately against rows that have `structure_asr`.

## What you still need to do

1. Keep the consumer running on a machine that stays on if you want continuous ingest.
2. Rotate the exposed SWIFT connection password after this implementation is deployed and verified.

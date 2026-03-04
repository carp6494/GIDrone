# NOTAM Owner Enricher

This is a separate one-shot helper for tower owner enrichment. It is intentionally outside the SWIFT queue consumer loop.

It:

1. Queries `public.notam_feed` for rows that have `structure_asr` and no `owner_name`
2. Downloads the official FCC ASR registration dataset (`r_tower.zip`) unless you point it at a local zip
3. Reads `EN.dat` from that dataset to resolve tower owner names
4. Updates `owner_name`, `owner_source`, and `owner_last_checked_at`

## Setup

1. From this folder, install dependencies:

```powershell
npm install
```

2. Provide the values from `.env.example` in your shell or a local `.env` loader.

3. Run the tool:

```powershell
npm start
```

## Notes

- `FCC_ASR_DATA_URL` defaults to the FCC `r_tower.zip` file under `https://data.fcc.gov/download/pub/uls/complete/`.
- `FCC_ASR_ZIP_PATH` lets you reuse a local FCC zip if you do not want to download it every run.
- `NOTAM_OWNER_DRY_RUN=true` prints the planned matches without writing back to Supabase.
- Rows with no FCC match are still marked with `owner_source=fcc-asr:not-found` and `owner_last_checked_at` so you can see they were checked.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import JSZip from "jszip";
import { createClient } from "@supabase/supabase-js";

const requireEnv = (name) => {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const optionalEnv = (name, fallback = "") => (process.env[name] ?? fallback).trim();

const parseInteger = (name, fallback) => {
  const raw = optionalEnv(name, String(fallback));
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const env = {
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  batchSize: parseInteger("NOTAM_OWNER_BATCH_SIZE", 100),
  fccAsrDataUrl: optionalEnv(
    "FCC_ASR_DATA_URL",
    "https://data.fcc.gov/download/pub/uls/complete/r_tower.zip"
  ),
  fccAsrZipPath: optionalEnv("FCC_ASR_ZIP_PATH", ""),
  dryRun: /^true$/i.test(optionalEnv("NOTAM_OWNER_DRY_RUN", "false")),
};

const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const log = (message, extra) => {
  const prefix = `[notam-owner ${new Date().toISOString()}]`;
  if (extra === undefined) {
    console.log(prefix, message);
    return;
  }
  console.log(prefix, message, extra);
};

const asString = (value) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const normalizeAsrDigits = (value) => {
  const digits = String(value ?? "").replace(/\D+/g, "");
  if (!digits) return null;
  return digits;
};

const toFccAsrKey = (digits) => `A${String(digits).padStart(7, "0")}`;

const pickOwnerName = (fields) => {
  const entityName = asString(fields[9]);
  if (entityName) return entityName;

  const personName = [fields[10], fields[11], fields[12], fields[13]]
    .map(asString)
    .filter(Boolean)
    .join(" ");

  return personName || null;
};

const ownerPriority = (entityType) => {
  const normalized = asString(entityType).toUpperCase();
  if (normalized === "O") return 3;
  if (normalized === "R") return 2;
  return 1;
};

const fetchPendingRows = async () => {
  const { data, error } = await supabase
    .from("notam_feed")
    .select("id, structure_asr")
    .not("structure_asr", "is", null)
    .is("owner_name", null)
    .order("updated_at", { ascending: false })
    .limit(env.batchSize);

  if (error) {
    throw new Error(`Failed querying notam_feed: ${error.message}`);
  }

  return Array.isArray(data) ? data : [];
};

const resolveZipPath = async () => {
  if (env.fccAsrZipPath) {
    const localPath = path.resolve(process.cwd(), env.fccAsrZipPath);
    await fs.access(localPath);
    return localPath;
  }

  const targetPath = path.join(os.tmpdir(), "fcc-r-tower.zip");
  log("Downloading FCC ASR registration dataset.", { url: env.fccAsrDataUrl });

  const response = await fetch(env.fccAsrDataUrl, {
    headers: {
      "user-agent": "gi-drone-notam-owner-enricher/0.1",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed downloading FCC ASR dataset (${response.status}).`);
  }

  const archive = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(targetPath, archive);
  return targetPath;
};

const readOwnerLookup = async (zipPath, wantedKeys) => {
  const buffer = await fs.readFile(zipPath);
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file("EN.dat");

  if (!entry) {
    throw new Error("FCC ASR archive is missing EN.dat.");
  }

  const content = await entry.async("string");
  const matches = new Map();

  for (const line of content.split(/\r?\n/)) {
    if (!line.startsWith("EN|REG|")) continue;

    const fields = line.split("|");
    const asrKey = asString(fields[2]);
    if (!wantedKeys.has(asrKey)) continue;

    const ownerName = pickOwnerName(fields);
    if (!ownerName) continue;

    const entityType = asString(fields[5]).toUpperCase();
    const priority = ownerPriority(entityType);
    const existing = matches.get(asrKey);

    if (
      !existing ||
      priority > existing.priority ||
      (priority === existing.priority && ownerName.length > existing.ownerName.length)
    ) {
      matches.set(asrKey, {
        ownerName,
        entityType,
        priority,
      });
    }
  }

  return matches;
};

const buildUpdates = (rows, ownerLookup) => {
  const checkedAt = new Date().toISOString();

  return rows.map((row) => {
    const digits = normalizeAsrDigits(row.structure_asr);
    const asrKey = digits ? toFccAsrKey(digits) : null;
    const owner = asrKey ? ownerLookup.get(asrKey) : null;

    return {
      id: row.id,
      owner_name: owner?.ownerName ?? null,
      owner_source: owner ? "fcc-asr:r_tower.EN.dat" : "fcc-asr:not-found",
      owner_last_checked_at: checkedAt,
    };
  });
};

const applyUpdates = async (updates) => {
  for (const update of updates) {
    const { id, ...payload } = update;
    const { error } = await supabase
      .from("notam_feed")
      .update(payload)
      .eq("id", id);

    if (error) {
      throw new Error(`Failed updating notam_feed row ${id}: ${error.message}`);
    }
  }
};

const main = async () => {
  const rows = await fetchPendingRows();

  if (rows.length === 0) {
    log("No NOTAM rows need owner enrichment.");
    return;
  }

  const wantedKeys = new Set(
    rows
      .map((row) => normalizeAsrDigits(row.structure_asr))
      .filter((value) => value !== null)
      .map((value) => toFccAsrKey(value))
  );

  const zipPath = await resolveZipPath();
  const ownerLookup = await readOwnerLookup(zipPath, wantedKeys);
  const updates = buildUpdates(rows, ownerLookup);
  const matched = updates.filter((row) => typeof row.owner_name === "string" && row.owner_name).length;
  const missing = updates.length - matched;

  if (env.dryRun) {
    log("Dry run only. No Supabase rows were updated.", {
      total: updates.length,
      matched,
      missing,
      sample: updates.slice(0, 5),
    });
    return;
  }

  await applyUpdates(updates);

  log("Owner enrichment complete.", {
    updated: updates.length,
    matched,
    missing,
  });
};

main().catch((error) => {
  console.error(
    "[notam-owner] Fatal error:",
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";
import solace from "solclientjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
});

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
  providerUrl: requireEnv("SWIFT_PROVIDER_URL"),
  queueName: requireEnv("SWIFT_QUEUE"),
  connectionFactory: optionalEnv("SWIFT_CONNECTION_FACTORY"),
  username: requireEnv("SWIFT_USERNAME"),
  password: requireEnv("SWIFT_PASSWORD"),
  vpnName: requireEnv("SWIFT_VPN"),
  ingestUrl: requireEnv("NOTAM_INGEST_URL"),
  ingestToken: requireEnv("NOTAM_INGEST_TOKEN"),
  captureDir: optionalEnv("SWIFT_CAPTURE_DIR", ""),
  allowNonUs: /^true$/i.test(optionalEnv("SWIFT_ALLOW_NON_US", "false")),
  batchSize: parseInteger("NOTAM_BATCH_SIZE", 1),
  flushMs: parseInteger("NOTAM_FLUSH_MS", 2000),
};

const log = (message, extra) => {
  const prefix = `[swift-notam ${new Date().toISOString()}]`;
  if (extra === undefined) {
    console.log(prefix, message);
    return;
  }
  console.log(prefix, message, extra);
};

const asArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
};

const localName = (name) => String(name ?? "").split(":").pop();

const walkLeaves = (input, visitor, keyHint = "") => {
  if (input == null) return;

  if (Array.isArray(input)) {
    for (const item of input) {
      walkLeaves(item, visitor, keyHint);
    }
    return;
  }

  if (typeof input === "object") {
    for (const [key, value] of Object.entries(input)) {
      const nextKey = localName(key);
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        visitor(nextKey, String(value));
      } else {
        walkLeaves(value, visitor, nextKey);
      }
    }
    return;
  }

  if (typeof input === "string" || typeof input === "number" || typeof input === "boolean") {
    visitor(keyHint, String(input));
  }
};

const normalizeWhitespace = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const findCandidateValue = (leafMap, keys) => {
  for (const key of keys) {
    const value = leafMap.get(key);
    if (value && value.length > 0) {
      return value[0];
    }
  }
  return "";
};

const findRawText = (payloadText, leafMap) => {
  const preferred = findCandidateValue(leafMap, [
    "rawText",
    "notamText",
    "message",
    "text",
    "body",
  ]);

  if (preferred) return preferred;

  const compact = normalizeWhitespace(payloadText);
  return compact.length > 4000 ? compact.slice(0, 4000) : compact;
};

const findDescription = (rawText, leafMap) => {
  const preferred = findCandidateValue(leafMap, [
    "description",
    "subject",
    "purpose",
    "condition",
    "summary",
  ]);

  if (preferred) return preferred;
  if (!rawText) return null;

  const firstSentence = rawText.split(/(?<=[.!?])\s+/)[0]?.trim() ?? "";
  if (firstSentence) return firstSentence.slice(0, 280);
  return rawText.slice(0, 280);
};

const buildLeafMap = (input) => {
  const leafMap = new Map();

  walkLeaves(input, (key, value) => {
    const trimmed = normalizeWhitespace(value);
    if (!trimmed) return;
    const bucket = leafMap.get(key) ?? [];
    bucket.push(trimmed);
    leafMap.set(key, bucket);
  });

  return leafMap;
};

const findCandidateValues = (leafMap, keys) => {
  const values = [];
  for (const key of keys) {
    const matches = leafMap.get(key);
    if (!matches?.length) continue;
    for (const value of matches) {
      if (!values.includes(value)) {
        values.push(value);
      }
    }
  }
  return values;
};

const parseFirstNumber = (value) => {
  const normalized = normalizeWhitespace(value).replace(/,/g, "");
  if (!normalized) return null;

  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const findNumericCandidate = (leafMap, keys) => {
  for (const value of findCandidateValues(leafMap, keys)) {
    const parsed = parseFirstNumber(value);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
};

const decodeDms = (digits, hemisphere, axis) => {
  const degDigits = axis === "lat" ? 2 : 3;
  const normalizedDigits = String(digits ?? "").trim();
  const expectedShort = degDigits + 2;
  const expectedLong = degDigits + 4;

  if (
    normalizedDigits.length !== expectedShort &&
    normalizedDigits.length !== expectedLong
  ) {
    return null;
  }

  const degrees = Number(normalizedDigits.slice(0, degDigits));
  const minutes = Number(normalizedDigits.slice(degDigits, degDigits + 2));
  const seconds =
    normalizedDigits.length === expectedLong
      ? Number(normalizedDigits.slice(degDigits + 2, degDigits + 4))
      : 0;

  if ([degrees, minutes, seconds].some((value) => !Number.isFinite(value))) {
    return null;
  }

  const decimal = degrees + minutes / 60 + seconds / 3600;
  const signed = /[SW]/i.test(String(hemisphere)) ? -decimal : decimal;
  const limit = axis === "lat" ? 90 : 180;
  return Math.abs(signed) <= limit ? signed : null;
};

const parseSingleCoordinate = (value, axis) => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return null;

  const direct = Number(normalized);
  if (Number.isFinite(direct)) {
    const limit = axis === "lat" ? 90 : 180;
    return Math.abs(direct) <= limit ? direct : null;
  }

  const compact = normalized.toUpperCase().replace(/[^0-9NSEW.+-]/g, "");
  if (!compact) return null;

  const match =
    axis === "lat"
      ? compact.match(/^(\d{4,6})([NS])$/)
      : compact.match(/^(\d{5,7})([EW])$/);

  if (!match) return null;
  return decodeDms(match[1], match[2], axis);
};

const extractCombinedCoordinate = (value) => {
  const normalized = normalizeWhitespace(value).toUpperCase().replace(/[^0-9NSEW]/g, "");
  if (!normalized) return null;

  const match = normalized.match(/(\d{4,6})([NS])(\d{5,7})([EW])/);
  if (!match) return null;

  const lat = decodeDms(match[1], match[2], "lat");
  const lon = decodeDms(match[3], match[4], "lon");
  if (lat === null || lon === null) return null;

  return { lat, lon };
};

const extractCoordinates = (rawText, leafMap) => {
  for (const value of findCandidateValues(leafMap, [
    "coordinates",
    "coordinate",
    "position",
    "geoPos",
    "point",
    "center",
  ])) {
    const parsed = extractCombinedCoordinate(value);
    if (parsed) return parsed;
  }

  const latValues = findCandidateValues(leafMap, [
    "centerLat",
    "featureLat",
    "latitude",
    "lat",
  ]);
  const lonValues = findCandidateValues(leafMap, [
    "centerLon",
    "featureLon",
    "longitude",
    "lon",
  ]);

  for (const latValue of latValues) {
    const lat = parseSingleCoordinate(latValue, "lat");
    if (lat === null) continue;
    for (const lonValue of lonValues) {
      const lon = parseSingleCoordinate(lonValue, "lon");
      if (lon === null) continue;
      return { lat, lon };
    }
  }

  return extractCombinedCoordinate(rawText);
};

const extractRadiusNm = (rawText, leafMap) => {
  const direct = findNumericCandidate(leafMap, ["radiusNm", "radius", "distanceNm"]);
  if (direct !== null && direct > 0) {
    return direct;
  }

  const patterns = [
    /\bRADIUS\s+(\d+(?:\.\d+)?)\s*(?:NM|NMI|NAUTICAL MILES?)\b/i,
    /\bWITHIN\s+(\d+(?:\.\d+)?)\s*(?:NM|NMI|NAUTICAL MILES?)\b/i,
    /\b(\d+(?:\.\d+)?)\s*(?:NM|NMI|NAUTICAL MILES?)\s+RADIUS\b/i,
  ];

  for (const pattern of patterns) {
    const match = rawText.match(pattern);
    if (!match) continue;
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
};

const GEOJSON_CIRCLE_STEPS = 48;
const EARTH_RADIUS_NM = 3440.065;

const buildPointGeometry = (lat, lon) => ({
  type: "Point",
  coordinates: [lon, lat],
});

const buildCircleGeometry = (centerLat, centerLon, radiusNm, steps = GEOJSON_CIRCLE_STEPS) => {
  if (
    !Number.isFinite(centerLat) ||
    !Number.isFinite(centerLon) ||
    !Number.isFinite(radiusNm) ||
    radiusNm <= 0
  ) {
    return null;
  }

  const angularDistance = radiusNm / EARTH_RADIUS_NM;
  const lat1 = (centerLat * Math.PI) / 180;
  const lon1 = (centerLon * Math.PI) / 180;
  const coordinates = [];

  for (let step = 0; step <= steps; step += 1) {
    const bearing = ((step / steps) * 2 * Math.PI);
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angularDistance) +
        Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
    );
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
        Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
      );

    coordinates.push([
      ((((lon2 * 180) / Math.PI) + 540) % 360) - 180,
      (lat2 * 180) / Math.PI,
    ]);
  }

  return {
    type: "Polygon",
    coordinates: [coordinates],
  };
};

const STRUCTURE_PATTERNS = [
  { pattern: /\bTOWER\b/i, type: "Tower", designator: "TOWER" },
  { pattern: /\bCRANE\b/i, type: "Crane", designator: "CRANE" },
  { pattern: /\bSTACK\b/i, type: "Stack", designator: "STACK" },
  { pattern: /\bMAST\b/i, type: "Mast", designator: "MAST" },
  { pattern: /\bBUILDING\b/i, type: "Building", designator: "BUILDING" },
  { pattern: /\bWIND(?:\s|-)?TURBINE\b/i, type: "Wind Turbine", designator: "WIND TURBINE" },
  { pattern: /\bPOWER\s+LINE\b/i, type: "Power Line", designator: "POWER LINE" },
  { pattern: /\bBRIDGE\b/i, type: "Bridge", designator: "BRIDGE" },
  { pattern: /\bOBST(?:ACLE)?\b/i, type: "Obstacle", designator: "OBST" },
];

const extractAsr = (rawText, leafMap) => {
  for (const value of findCandidateValues(leafMap, ["structureAsr", "asr"])) {
    const match = normalizeWhitespace(value).match(/\b(\d{6,8})\b/);
    if (match) return match[1];
  }

  const match = rawText.match(/\bASR\s*(?:#|NO\.?|NUMBER)?\s*(\d{6,8})\b/i);
  return match ? match[1] : null;
};

const extractStructureDescriptor = (rawText, leafMap) => {
  const directType = findCandidateValue(leafMap, ["structureType", "verticalStructureType"]);
  const directDesignator = findCandidateValue(leafMap, ["structureDesignator"]);

  let matchedPattern = null;
  for (const candidate of STRUCTURE_PATTERNS) {
    if (candidate.pattern.test(rawText)) {
      matchedPattern = candidate;
      break;
    }
  }

  return {
    structureType: directType || matchedPattern?.type || null,
    structureDesignator: directDesignator || matchedPattern?.designator || null,
  };
};

const extractStructureHeights = (rawText, leafMap) => {
  const structureHeightFt =
    findNumericCandidate(leafMap, ["structureHeightFt", "heightFt", "heightAgl", "height"]) ??
    parseFirstNumber(
      rawText.match(/(\d+(?:\.\d+)?)\s*FT\s*(?:AGL|ABOVE GROUND LEVEL)\b/i)?.[1] ?? ""
    );

  const structureElevationFt =
    findNumericCandidate(leafMap, [
      "structureElevationFt",
      "elevationFt",
      "elevation",
      "elevationMsl",
    ]) ??
    parseFirstNumber(rawText.match(/(\d+(?:\.\d+)?)\s*FT\s*(?:AMSL|MSL)\b/i)?.[1] ?? "");

  return {
    structureHeightFt:
      structureHeightFt !== null && structureHeightFt > 0 ? structureHeightFt : null,
    structureElevationFt:
      structureElevationFt !== null && structureElevationFt > 0 ? structureElevationFt : null,
  };
};

const extractLighting = (rawText, leafMap) => {
  const rawLighting =
    findCandidateValue(leafMap, ["lightingStatus", "lighting"]) || rawText;
  const normalized = normalizeWhitespace(rawLighting).toUpperCase();

  if (!normalized) {
    return { lightingPresent: null, lightingStatus: null };
  }
  if (/\bUNLIT\b/.test(normalized)) {
    return { lightingPresent: false, lightingStatus: "Unlit" };
  }
  if (
    /\b(?:OBST\s+)?LGT(?:S)?\s+OTS\b/.test(normalized) ||
    /\bLIGHT(?:S|ING)?\s+(?:OUT|OUT OF SERVICE)\b/.test(normalized)
  ) {
    return { lightingPresent: true, lightingStatus: "Out of service" };
  }
  if (/\bLGTD\b/.test(normalized) || /\bLIGHTED\b/.test(normalized) || /\bLIGHTING\b/.test(normalized)) {
    return { lightingPresent: true, lightingStatus: "Lighted" };
  }

  return { lightingPresent: null, lightingStatus: null };
};

const deriveGeometry = (rawText, leafMap) => {
  const coordinates = extractCoordinates(rawText, leafMap);
  if (!coordinates) {
    return {
      geomType: null,
      centerLat: null,
      centerLon: null,
      radiusNm: null,
      featureLat: null,
      featureLon: null,
      geojson: null,
    };
  }

  const radiusNm = extractRadiusNm(rawText, leafMap);
  if (radiusNm !== null && radiusNm > 0) {
    return {
      geomType: "circle",
      centerLat: coordinates.lat,
      centerLon: coordinates.lon,
      radiusNm,
      featureLat: coordinates.lat,
      featureLon: coordinates.lon,
      geojson: buildCircleGeometry(coordinates.lat, coordinates.lon, radiusNm),
    };
  }

  return {
    geomType: "point",
    centerLat: null,
    centerLon: null,
    radiusNm: null,
    featureLat: coordinates.lat,
    featureLon: coordinates.lon,
    geojson: buildPointGeometry(coordinates.lat, coordinates.lon),
  };
};

const safeIsoString = (value) => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return null;

  const parsed = Date.parse(normalized);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString();
  }
  return null;
};

const parseCompactNotamTime = (value) => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return null;

  if (/^\d{12}$/.test(normalized)) {
    const year = normalized.slice(0, 4);
    const month = normalized.slice(4, 6);
    const day = normalized.slice(6, 8);
    const hour = normalized.slice(8, 10);
    const minute = normalized.slice(10, 12);
    return safeIsoString(`${year}-${month}-${day}T${hour}:${minute}:00Z`);
  }

  if (/^\d{10}$/.test(normalized)) {
    const year = `20${normalized.slice(0, 2)}`;
    const month = normalized.slice(2, 4);
    const day = normalized.slice(4, 6);
    const hour = normalized.slice(6, 8);
    const minute = normalized.slice(8, 10);
    return safeIsoString(`${year}-${month}-${day}T${hour}:${minute}:00Z`);
  }

  return safeIsoString(normalized);
};

const stripHtmlLikeText = (value) =>
  normalizeWhitespace(
    String(value ?? "")
      .replace(/&lt;br\s*\/?&gt;/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
  );

const formatNotamNumber = (value) => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return "";

  if (/^\d+$/.test(normalized)) {
    return normalized.padStart(3, "0");
  }

  return normalized;
};

const US_ICAO_PREFIXES = [
  "K",
  "PA",
  "PF",
  "PO",
  "PP",
  "PH",
  "PG",
  "PJ",
  "PK",
  "PM",
  "PT",
  "PW",
  "TJ",
  "TI",
  "NS",
];

const monthFromIso = (value) => {
  const iso = safeIsoString(value);
  if (!iso) return "";
  return iso.slice(5, 7);
};

const isUsFacilityIcao = (value) => {
  const facility = normalizeWhitespace(value).toUpperCase();
  if (!facility) return false;
  return US_ICAO_PREFIXES.some((prefix) => facility.startsWith(prefix));
};

const isDomesticClassification = (value) => normalizeWhitespace(value).toUpperCase() === "DOM";

const extractPayloadClassifications = (payload) => {
  const values = [];
  walkLeaves(payload, (key, value) => {
    if (key === "classification") {
      const normalized = normalizeWhitespace(value);
      if (normalized) {
        values.push(normalized);
      }
    }
  });
  return values;
};

const shouldPersistNotam = (item) => {
  if (env.allowNonUs) return true;
  if (isUsFacilityIcao(item.facilityIcao)) return true;

  return extractPayloadClassifications(item?.payload).some(isDomesticClassification);
};

const findIsoCandidate = (leafMap, keys) => {
  for (const value of findCandidateValues(leafMap, keys)) {
    const iso = safeIsoString(value) ?? parseCompactNotamTime(value);
    if (iso) return iso;
  }
  return null;
};

const extractFacilityCode = (baseItem, leafMap) => {
  const direct = findCandidateValue(leafMap, [
    "facilityCode",
    "accountId",
    "icaoLocation",
    "locationIndicatorICAO",
    "accountableLocation",
  ]);

  if (direct) {
    return normalizeWhitespace(direct).toUpperCase() || null;
  }

  if (baseItem.facilityIcao) {
    return normalizeWhitespace(baseItem.facilityIcao).toUpperCase() || null;
  }

  const prefixMatch = normalizeWhitespace(baseItem.notamId).match(/^([A-Z0-9]{3,5})\d{2}\//);
  return prefixMatch ? prefixMatch[1] : null;
};

const extractAirspaceLimits = (leafMap) => ({
  minimumFl:
    findCandidateValue(leafMap, [
      "minimumFl",
      "minimumFlightLevel",
      "lowerLimit",
      "lowerLimitReference",
    ]) || null,
  maximumFl:
    findCandidateValue(leafMap, [
      "maximumFl",
      "maximumFlightLevel",
      "upperLimit",
      "upperLimitReference",
    ]) || null,
});

const enrichNormalizedNotam = (baseItem, leafMap) => {
  const rawText = normalizeWhitespace(baseItem.rawText ?? baseItem.description ?? "");
  const geometry = deriveGeometry(rawText, leafMap);
  const { structureType, structureDesignator } = extractStructureDescriptor(rawText, leafMap);
  const { structureHeightFt, structureElevationFt } = extractStructureHeights(rawText, leafMap);
  const { lightingPresent, lightingStatus } = extractLighting(rawText, leafMap);
  const { minimumFl, maximumFl } = extractAirspaceLimits(leafMap);
  const subtypeParts = normalizeWhitespace(baseItem.subtype ?? "").split("/").filter(Boolean);
  const trafficCandidate = baseItem.traffic ?? findCandidateValue(leafMap, ["traffic"]) ?? null;
  const purposeCandidate = baseItem.purpose ?? findCandidateValue(leafMap, ["purpose"]) ?? null;
  const scopeCandidate = baseItem.scope ?? findCandidateValue(leafMap, ["scope"]) ?? null;
  const traffic = trafficCandidate || subtypeParts[0] || null;
  const purpose = purposeCandidate || subtypeParts[1] || null;
  const scope = scopeCandidate || subtypeParts[2] || null;

  return {
    ...baseItem,
    facilityCode: baseItem.facilityCode ?? extractFacilityCode(baseItem, leafMap),
    issuedAt:
      baseItem.issuedAt ??
      findIsoCandidate(leafMap, ["issued", "issueTime", "issueDate", "creationDate"]),
    accountId:
      baseItem.accountId ??
      (findCandidateValue(leafMap, ["accountId", "accountableLocation"]) || null),
    affectedFir:
      baseItem.affectedFir ??
      (findCandidateValue(leafMap, ["affectedFir", "fir", "region"]) || null),
    selectionCode:
      baseItem.selectionCode ??
      baseItem.category ??
      (findCandidateValue(leafMap, ["selectionCode", "classification"]) || null),
    traffic,
    purpose,
    scope,
    minimumFl,
    maximumFl,
    ...geometry,
    structureType,
    structureDesignator,
    structureAsr: extractAsr(rawText, leafMap),
    structureHeightFt,
    structureElevationFt,
    lightingPresent,
    lightingStatus,
    ownerName: null,
    ownerSource: null,
    ownerLastCheckedAt: null,
  };
};

const extractStructuredNotam = (parsedPayload, fallbackMessageId) => {
  const root = parsedPayload?.AIXMBasicMessage;
  const members = asArray(root?.hasMember);

  let eventTimeSlice = null;
  let airportTimeSlice = null;

  for (const member of members) {
    if (!eventTimeSlice && member?.Event) {
      const slices = asArray(member.Event.timeSlice)
        .map((slice) => slice?.EventTimeSlice ?? slice)
        .filter(Boolean);
      eventTimeSlice = slices.find((slice) => slice?.textNOTAM?.NOTAM) ?? slices[0] ?? null;
    }

    if (!airportTimeSlice && member?.AirportHeliport) {
      const slices = asArray(member.AirportHeliport.timeSlice)
        .map((slice) => slice?.AirportHeliportTimeSlice ?? slice)
        .filter(Boolean);
      airportTimeSlice = slices[0] ?? null;
    }
  }

  const notam = eventTimeSlice?.textNOTAM?.NOTAM;
  if (!notam || typeof notam !== "object") {
    return null;
  }

  const translations = asArray(notam.translation)
    .map((translation) => translation?.NOTAMTranslation ?? translation)
    .filter(Boolean);

  const localFormat =
    translations.find((translation) => translation?.type === "LOCAL_FORMAT") ?? null;
  const icaoFormat =
    translations.find((translation) => String(translation?.type ?? "").includes("ICAO")) ?? null;

  const eventExtension = eventTimeSlice?.extension?.EventExtension ?? null;
  const accountId = normalizeWhitespace(eventExtension?.accountId ?? "");
  const issuedAt =
    safeIsoString(notam.issued) ??
    parseCompactNotamTime(notam.effectiveStart) ??
    safeIsoString(eventExtension?.lastUpdated);
  const issuedMonth = monthFromIso(issuedAt);
  const formattedNumber = formatNotamNumber(notam.number);

  let notamId = "";
  const localFormatText = normalizeWhitespace(localFormat?.simpleText ?? "");
  const localFormatMatch = localFormatText.match(/^!([A-Z0-9]+)\s+(\d{2}\/\d{2,4})\b/i);
  if (localFormatMatch) {
    notamId = `${localFormatMatch[1].toUpperCase()}${localFormatMatch[2]}`;
  } else if (accountId && issuedMonth && formattedNumber) {
    notamId = `${accountId}${issuedMonth}/${formattedNumber}`;
  } else if (formattedNumber) {
    notamId = formattedNumber;
  } else {
    notamId = `SWIFT-${fallbackMessageId}`;
  }

  const facilityIcao = normalizeWhitespace(
    eventExtension?.icaoLocation ??
      airportTimeSlice?.locationIndicatorICAO ??
      ""
  ).toUpperCase() || null;

  const location = normalizeWhitespace(
    eventExtension?.airportname ??
      airportTimeSlice?.name ??
      notam.location ??
      ""
  ) || null;

  const description =
    normalizeWhitespace(notam.text ?? "") ||
    stripHtmlLikeText(icaoFormat?.formattedText ?? "") ||
    (localFormatText ? localFormatText.replace(/^![A-Z0-9]+\s+\d{2}\/\d{2,4}\s+/i, "") : "") ||
    null;

  const rawText =
    localFormatText ||
    stripHtmlLikeText(icaoFormat?.formattedText ?? "") ||
    description ||
    null;

  const subtype = [notam.traffic, notam.purpose, notam.scope]
    .map((value) => normalizeWhitespace(value))
    .filter(Boolean)
    .join("/") || null;

  return {
    id: notamId,
    notamId,
    facilityIcao,
    facilityCode: facilityIcao || accountId || null,
    type: normalizeWhitespace(notam.type) || "NOTAM",
    category:
      normalizeWhitespace(notam.selectionCode) ||
      normalizeWhitespace(eventExtension?.classification) ||
      null,
    subtype,
    description,
    state: null,
    location,
    startsAt:
      parseCompactNotamTime(notam.effectiveStart) ??
      safeIsoString(eventTimeSlice?.validTime?.TimePeriod?.beginPosition) ??
      issuedAt,
    endsAt:
      parseCompactNotamTime(notam.effectiveEnd) ??
      safeIsoString(eventTimeSlice?.validTime?.TimePeriod?.endPosition),
    issuedAt,
    rawText,
    accountId: accountId || null,
    affectedFir: normalizeWhitespace(eventExtension?.fir ?? "") || null,
    selectionCode:
      normalizeWhitespace(notam.selectionCode) ||
      normalizeWhitespace(eventExtension?.classification) ||
      null,
    traffic: normalizeWhitespace(notam.traffic) || null,
    purpose: normalizeWhitespace(notam.purpose) || null,
    scope: normalizeWhitespace(notam.scope) || null,
    source: "swift-scds",
    payload: parsedPayload,
  };
};

const deriveNormalizedNotam = (messageId, payloadText, parsedPayload) => {
  const leafMap = buildLeafMap(parsedPayload);
  const structured = extractStructuredNotam(parsedPayload, messageId);
  if (structured) {
    return enrichNormalizedNotam(structured, leafMap);
  }

  const rawText = findRawText(payloadText, leafMap);
  const notamId =
    findCandidateValue(leafMap, [
      "notamId",
      "notamNumber",
      "id",
      "designator",
      "number",
      "sequenceNumber",
    ]) || `SWIFT-${messageId}`;

  const facilityIcao =
    findCandidateValue(leafMap, [
      "icaoLocationIndicator",
      "locationIndicatorICAO",
      "accountableLocation",
      "location",
      "airportHeliport",
      "aerodrome",
      "fir",
    ])
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 4) || null;

  const startsAt = safeIsoString(
    findCandidateValue(leafMap, ["startPosition", "beginPosition", "effectiveStart", "startTime"])
  );
  const endsAt = safeIsoString(
    findCandidateValue(leafMap, ["endPosition", "effectiveEnd", "endTime", "expiryTime"])
  );

  const category = findCandidateValue(leafMap, ["keyword", "purpose", "series"]) || null;
  const subtype = findCandidateValue(leafMap, ["scope", "traffic", "type"]) || null;
  const state = findCandidateValue(leafMap, ["state", "region", "province"]) || null;
  const location =
    findCandidateValue(leafMap, ["city", "name", "airportName", "aerodromeName"]) || null;
  const description = findDescription(rawText, leafMap);

  const baseItem = {
    id: notamId,
    notamId,
    facilityIcao,
    type: "NOTAM",
    category,
    subtype,
    description,
    state,
    location,
    startsAt,
    endsAt,
    rawText,
    source: "swift-scds",
    payload: parsedPayload && typeof parsedPayload === "object" ? parsedPayload : { raw: payloadText },
  };

  return enrichNormalizedNotam(baseItem, leafMap);
};

const ensureCaptureDir = async () => {
  if (!env.captureDir) return null;
  const resolved = path.resolve(__dirname, env.captureDir);
  await fs.mkdir(resolved, { recursive: true });
  return resolved;
};

const readMessageBody = (message) => {
  const xmlContent = typeof message.getXmlContent === "function" ? message.getXmlContent() : null;
  if (typeof xmlContent === "string" && xmlContent.trim()) {
    return xmlContent;
  }

  const binaryAttachment =
    typeof message.getBinaryAttachment === "function" ? message.getBinaryAttachment() : null;

  if (binaryAttachment) {
    if (Buffer.isBuffer(binaryAttachment)) {
      return binaryAttachment.toString("utf8");
    }
    if (binaryAttachment instanceof ArrayBuffer) {
      return Buffer.from(binaryAttachment).toString("utf8");
    }
    if (ArrayBuffer.isView(binaryAttachment)) {
      return Buffer.from(binaryAttachment.buffer).toString("utf8");
    }
    return String(binaryAttachment);
  }

  const dump = typeof message.dump === "function" ? message.dump() : "";
  return typeof dump === "string" ? dump : "";
};

const parsePayload = (payloadText) => {
  const trimmed = payloadText.trim();
  if (!trimmed) return { parsed: null, isXml: false };

  if (!trimmed.startsWith("<")) {
    return { parsed: { rawText: trimmed }, isXml: false };
  }

  try {
    return { parsed: parser.parse(trimmed), isXml: true };
  } catch (error) {
    return {
      parsed: { rawText: trimmed, parseError: error instanceof Error ? error.message : "Unknown XML parse error" },
      isXml: false,
    };
  }
};

const postBatch = async (items) => {
  const response = await fetch(env.ingestUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.ingestToken}`,
    },
    body: JSON.stringify({ items }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ingest failed (${response.status}): ${text}`);
  }

  return response.json();
};

const writeCapture = async (captureDir, messageId, payloadText) => {
  if (!captureDir) return;
  const filePath = path.join(captureDir, `${Date.now()}-${messageId}.xml`);
  await fs.writeFile(filePath, payloadText, "utf8");
};

const createConsumerState = () => ({
  session: null,
  consumer: null,
  processing: false,
  reconnectTimer: null,
  captureDir: null,
});

const state = createConsumerState();

const scheduleReconnect = (delayMs = 5000) => {
  if (state.reconnectTimer) return;
  state.reconnectTimer = setTimeout(async () => {
    state.reconnectTimer = null;
    try {
      await connectAndConsume();
    } catch (error) {
      log("Reconnect failed.", error instanceof Error ? error.message : String(error));
      scheduleReconnect(delayMs);
    }
  }, delayMs);
};

const disposeConsumer = () => {
  try {
    state.consumer?.disconnect?.();
  } catch {}
  try {
    state.consumer?.dispose?.();
  } catch {}
  state.consumer = null;
};

const disconnectSession = () => {
  try {
    state.session?.disconnect?.();
  } catch {}
  state.session = null;
};

const requeueCurrentMessage = async (message, error) => {
  log("Message processing failed. Leaving it unacknowledged so it can be redelivered.", {
    error: error instanceof Error ? error.message : String(error),
  });
  try {
    state.consumer?.stop?.();
  } catch {}
  disposeConsumer();
  disconnectSession();
  scheduleReconnect();
  return message;
};

const processMessage = async (message) => {
  const payloadText = readMessageBody(message);
  const messageId = crypto.createHash("sha1").update(payloadText || crypto.randomUUID()).digest("hex");
  const { parsed } = parsePayload(payloadText);
  const normalized = deriveNormalizedNotam(messageId, payloadText, parsed);

  if (state.captureDir) {
    await writeCapture(state.captureDir, messageId, payloadText);
  }

  if (!shouldPersistNotam(normalized)) {
    return;
  }

  const result = await postBatch([normalized]);
  log("Ingested NOTAM message.", {
    notamId: normalized.notamId,
    facility: normalized.facilityIcao,
    ingested: result?.ingested ?? 1,
  });
};

const buildQueueDescriptor = () =>
  new solace.QueueDescriptor({
    name: env.queueName,
    type: solace.QueueType.QUEUE,
  });

const connectAndConsume = async () => {
  if (state.session) return;

  state.captureDir = await ensureCaptureDir();

  solace.SolclientFactory.init({
    profile: solace.SolclientFactoryProfiles.version10,
  });

  const session = solace.SolclientFactory.createSession({
    url: env.providerUrl,
    userName: env.username,
    password: env.password,
    vpnName: env.vpnName,
    connectRetries: 3,
    reconnectRetries: 3,
    connectTimeoutInMsecs: 10000,
  });

  session.on(solace.SessionEventCode.UP_NOTICE, () => {
    log("SWIFT session connected.", {
      providerUrl: env.providerUrl,
      vpn: env.vpnName,
      queue: env.queueName,
      connectionFactory: env.connectionFactory || "(documented only)",
    });

    const consumer = session.createMessageConsumer({
      queueDescriptor: buildQueueDescriptor(),
      acknowledgeMode: solace.MessageConsumerAcknowledgeMode.CLIENT,
      activeIndicationEnabled: true,
      windowSize: 1,
    });

    consumer.on(solace.MessageConsumerEventName.UP, () => {
      log("Queue consumer connected.");
      try {
        consumer.start();
      } catch {}
    });

    consumer.on(solace.MessageConsumerEventName.CONNECT_FAILED_ERROR, (error) => {
      log("Queue consumer failed to connect.", error instanceof Error ? error.message : String(error));
      disposeConsumer();
      disconnectSession();
      scheduleReconnect();
    });

    consumer.on(solace.MessageConsumerEventName.DOWN_ERROR, (error) => {
      log("Queue consumer dropped.", error instanceof Error ? error.message : String(error));
      disposeConsumer();
      disconnectSession();
      scheduleReconnect();
    });

    consumer.on(solace.MessageConsumerEventName.MESSAGE, (message) => {
      if (state.processing) {
        return;
      }

      state.processing = true;

      Promise.resolve()
        .then(() => processMessage(message))
        .then(() => {
          message.acknowledge();
        })
        .catch((error) => requeueCurrentMessage(message, error))
        .finally(() => {
          state.processing = false;
        });
    });

    state.consumer = consumer;
    consumer.connect();
  });

  session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, (event) => {
    log("SWIFT session failed to connect.", event?.infoStr ?? String(event));
    disconnectSession();
    scheduleReconnect();
  });

  session.on(solace.SessionEventCode.DISCONNECTED, (event) => {
    log("SWIFT session disconnected.", event?.infoStr ?? String(event));
    disposeConsumer();
    disconnectSession();
    scheduleReconnect();
  });

  state.session = session;
  session.connect();
};

process.on("SIGINT", () => {
  log("Shutting down consumer.");
  disposeConsumer();
  disconnectSession();
  process.exit(0);
});

process.on("SIGTERM", () => {
  log("Shutting down consumer.");
  disposeConsumer();
  disconnectSession();
  process.exit(0);
});

connectAndConsume().catch((error) => {
  console.error("[swift-notam] Fatal startup error:", error);
  process.exit(1);
});

import { SCHEMA_URL } from "@time-capsule/schema";
import { HttpBytes, safeFetch, scrubSecrets, type OneShot } from "./fetch.ts";
import { cleanText, parseRssItems } from "./rss.ts";
import { taipeiParts } from "./time.ts";
import { hasSimplifiedChinese } from "./script.ts";
import {
  COUNTY_CODES,
  CWA_ATTRIBUTION,
  CWA_FORECAST_URL,
  CWA_OBSERVATION_URL,
  TRENDS_ATTRIBUTION,
  TW,
  trendsExploreUrl,
  trendsRssUrl,
  type RegionProfile,
} from "./sources.ts";
import type { Snapshot } from "./normalize.ts";
import { collectKkboxSongs, type KkboxCredentials } from "./songs.ts";

const TREND_LIMIT = 10;

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotError";
  }
}

export type CollectOptions = {
  now?: Date;
  region?: RegionProfile;
  oneShot?: OneShot;
  cwaApiKey?: string;
  requireConfiguredSources?: boolean;
  priceObservations?: Snapshot["prices"];
  /** Optional. Without it the songs section stays unavailable. */
  kkbox?: KkboxCredentials;
  /** Problems that do not stop publishing, such as a chart response that no longer parses. */
  onWarning?: (message: string) => void;
};

type SourceResult<T> = { ok: true; value: T } | { ok: false };

async function fetchText(
  url: string,
  options: CollectOptions,
  extra?: { headers?: Record<string, string>; maxBytes?: number; allowPrefix?: boolean; secrets?: string[] },
): Promise<HttpBytes> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await safeFetch(url, {
        headers: extra?.headers,
        maxBytes: extra?.maxBytes,
        allowPrefix: extra?.allowPrefix,
        oneShot: options.oneShot,
        secrets: extra?.secrets,
      });
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error("fetch failed");
}

type CwaElement = {
  elementName?: string;
  time?: Array<{ startTime?: string; endTime?: string; parameter?: { parameterName?: string } }>;
};

function selectPeriod(times: CwaElement["time"], now: Date): { parameterName?: string } | undefined {
  if (!times || times.length === 0) return undefined;
  const instant = now.getTime();
  for (const slot of times) {
    const start = slot.startTime ? Date.parse(slot.startTime.replace(" ", "T") + "+08:00") : NaN;
    const end = slot.endTime ? Date.parse(slot.endTime.replace(" ", "T") + "+08:00") : NaN;
    if (Number.isFinite(start) && Number.isFinite(end) && instant >= start && instant < end) {
      return slot.parameter;
    }
  }
  return times[0]?.parameter;
}

export function parseCwaForecast(body: string, now: Date): Snapshot["weather"]["by_county"] {
  const parsed = JSON.parse(body) as {
    records?: { location?: Array<{ locationName?: string; weatherElement?: CwaElement[] }> };
  };
  const locations = parsed.records?.location;
  if (!Array.isArray(locations)) throw new Error("missing locations");
  const byCounty: Snapshot["weather"]["by_county"] = {};
  for (const location of locations) {
    const code = location.locationName ? COUNTY_CODES[location.locationName] : undefined;
    if (!code || !location.weatherElement) continue;
    const element = (name: string) => location.weatherElement?.find((item) => item.elementName === name);
    const min = Number(selectPeriod(element("MinT")?.time, now)?.parameterName);
    const max = Number(selectPeriod(element("MaxT")?.time, now)?.parameterName);
    const summary = selectPeriod(element("Wx")?.time, now)?.parameterName ?? "";
    if (!Number.isFinite(min) || !Number.isFinite(max) || !summary) continue;
    byCounty[code] = { name: location.locationName!, t_min_c: min, t_max_c: max, summary, note: null };
  }
  return byCounty;
}

const OBSERVATION_MAX_ALTITUDE_M = 500;
const OBSERVATION_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/;

type CwaStation = {
  GeoInfo?: { CountyName?: unknown; StationAltitude?: unknown };
  ObsTime?: { DateTime?: unknown };
  WeatherElement?: { AirTemperature?: unknown; Weather?: unknown };
};

export type CwaObservation = { t_now_c: number; summary: string | null; observed_at: string | null };

function observedNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  return Number.isFinite(number) && number > -60 && number < 60 ? number : null;
}

function observedWeather(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" || text === "-99" || text.toUpperCase() === "X" ? null : text;
}

/**
 * The current reading of each 縣市 from 現在天氣觀測報告 (O-A0003-001): the median air temperature of its stations at or
 * below 500 m, the most common weather word among them, and the latest observation time. -99 and X are missing values.
 */
export function parseCwaObservation(body: string): Record<string, CwaObservation> {
  const parsed = JSON.parse(body) as { records?: { Station?: unknown } };
  const stations = parsed.records?.Station;
  if (!Array.isArray(stations)) throw new Error("missing stations");
  const grouped = new Map<string, { temps: number[]; words: Map<string, number>; times: string[] }>();
  for (const raw of stations as CwaStation[]) {
    const countyName = raw?.GeoInfo?.CountyName;
    const code = typeof countyName === "string" ? COUNTY_CODES[countyName] : undefined;
    if (!code) continue;
    const altitude = Number(String(raw.GeoInfo?.StationAltitude ?? "").trim());
    if (Number.isFinite(altitude) && altitude > OBSERVATION_MAX_ALTITUDE_M) continue;
    const temp = observedNumber(raw.WeatherElement?.AirTemperature);
    if (temp === null) continue;
    const group = grouped.get(code) ?? { temps: [], words: new Map<string, number>(), times: [] };
    group.temps.push(temp);
    const word = observedWeather(raw.WeatherElement?.Weather);
    if (word) group.words.set(word, (group.words.get(word) ?? 0) + 1);
    const time = raw.ObsTime?.DateTime;
    if (typeof time === "string" && OBSERVATION_TIME.test(time)) group.times.push(time);
    grouped.set(code, group);
  }
  const out: Record<string, CwaObservation> = {};
  for (const [code, group] of grouped) {
    const temps = [...group.temps].sort((a, b) => a - b);
    const middle = Math.floor(temps.length / 2);
    const median = temps.length % 2 === 1 ? temps[middle]! : (temps[middle - 1]! + temps[middle]!) / 2;
    const words = [...group.words.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const times = [...group.times].sort((a, b) => Date.parse(b) - Date.parse(a));
    out[code] = { t_now_c: Math.round(median * 10) / 10, summary: words[0]?.[0] ?? null, observed_at: times[0] ?? null };
  }
  return out;
}

async function collectObservation(
  options: CollectOptions,
  apiKey: string,
): Promise<Record<string, CwaObservation> | null> {
  try {
    const response = await fetchText(CWA_OBSERVATION_URL, options, {
      headers: { authorization: apiKey, accept: "application/json" },
      secrets: [apiKey],
      maxBytes: 8_000_000,
    });
    if (response.status < 200 || response.status >= 300) return null;
    const observed = parseCwaObservation(response.text());
    return Object.keys(observed).length === 0 ? null : observed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    options.onWarning?.(`weather observation failed: ${scrubSecrets(message, [apiKey])}`);
    return null;
  }
}

async function collectWeather(
  options: CollectOptions,
  now: Date,
): Promise<SourceResult<Snapshot["weather"]["by_county"]>> {
  const apiKey = options.cwaApiKey?.trim() ?? "";
  if (!apiKey) {
    if (options.requireConfiguredSources) throw new SnapshotError("CWA_API_KEY is required");
    return { ok: false };
  }
  let response: HttpBytes;
  try {
    response = await fetchText(CWA_FORECAST_URL, options, {
      headers: { authorization: apiKey, accept: "application/json" },
      secrets: [apiKey],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes(apiKey)) throw new SnapshotError(scrubSecrets(message, [apiKey]));
    return { ok: false };
  }
  if (response.status < 200 || response.status >= 300) return { ok: false };
  try {
    const counties = parseCwaForecast(response.text(), now);
    if (Object.keys(counties).length === 0) throw new Error("no counties");
    const observed = await collectObservation(options, apiKey);
    if (observed) {
      for (const [code, reading] of Object.entries(observed)) {
        const county = counties[code];
        if (!county) continue;
        counties[code] = {
          ...county,
          summary: reading.summary ?? county.summary,
          t_now_c: reading.t_now_c,
          ...(reading.observed_at ? { observed_at: reading.observed_at } : {}),
        };
      }
    }
    return { ok: true, value: counties };
  } catch (error) {
    throw new SnapshotError(`canary parse failed for weather: ${error instanceof Error ? error.message : "parse"}`);
  }
}

async function collectTrends(
  options: CollectOptions,
  region: RegionProfile,
): Promise<SourceResult<Snapshot["trends"]["items"]>> {
  const rssUrl = trendsRssUrl(region.trendsGeo);
  let response: HttpBytes;
  try {
    response = await fetchText(rssUrl, options, { maxBytes: 512_000 });
  } catch {
    return { ok: false };
  }
  if (response.status < 200 || response.status >= 300) return { ok: false };
  const items = parseRssItems(response.text(), TREND_LIMIT);
  if (items.length === 0) throw new SnapshotError("canary parse failed for trends");
  const trends = items
    .map((item, index) => {
      const term = [...cleanText(item.title)].slice(0, 200).join("");
      if (!term || hasSimplifiedChinese(term)) return null;
      return { rank: index + 1, term, url: trendsExploreUrl(term, region.trendsGeo) };
    })
    .filter((item): item is Snapshot["trends"]["items"][number] => item !== null);
  if (trends.length === 0) throw new SnapshotError("canary parse failed for trends");
  return { ok: true, value: trends };
}

export async function collectSnapshot(options: CollectOptions = {}): Promise<Snapshot> {
  const now = options.now ?? new Date();
  const region = options.region ?? TW;
  const { date, generatedAt } = taipeiParts(now);
  if (options.requireConfiguredSources && !options.cwaApiKey?.trim()) {
    throw new SnapshotError("CWA_API_KEY is required");
  }
  const [weather, trends, songs] = await Promise.all([
    collectWeather(options, now),
    collectTrends(options, region),
    collectKkboxSongs(options.kkbox, { oneShot: options.oneShot, snapshotDate: date }),
  ]);
  // Songs never block a day: weather cannot be fetched again later.
  if (!songs.ok && songs.problem) options.onWarning?.(`songs parse failed: ${songs.problem}`);
  const networkOk = [weather.ok, trends.ok].filter(Boolean).length;
  if (networkOk === 0) throw new SnapshotError("all network sources failed");
  const missing: string[] = [];
  if (!weather.ok) missing.push("weather");
  if (!trends.ok) missing.push("trends");
  const prices = options.priceObservations ?? [];
  if (prices.length === 0) missing.push("prices");
  if (!songs.ok) missing.push("songs");
  return {
    schema: SCHEMA_URL,
    schema_version: 1,
    schema_minor: 3,
    region: region.code,
    date,
    generated_at: generatedAt,
    weather: {
      source: "中央氣象署",
      attribution: CWA_ATTRIBUTION,
      by_county: weather.ok ? weather.value : {},
    },
    songs: songs.ok
      ? { ...songs.value, status: "ok" }
      : {
          source: null,
          chart_date: null,
          items: [],
          status: "unavailable",
          note: !songs.configured
            ? "尚無允許公開再散布的排行榜來源"
            : songs.problem
              ? "排行榜格式改變，這天沒有記錄"
              : "排行榜抓取失敗",
        },
    prices,
    trends: {
      source: "Google Trends",
      attribution: TRENDS_ATTRIBUTION,
      items: trends.ok ? trends.value : [],
    },
    missing,
    signature: null,
  };
}

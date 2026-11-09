import { SCHEMA_URL } from "@time-capsule/schema";

export type TrendItem = {
  rank: number;
  term: string;
  url: string;
};

export type Snapshot = {
  schema: string;
  schema_version: 1;
  schema_minor: number;
  region: string;
  date: string;
  generated_at: string;
  weather: {
    source: string;
    attribution?: string;
    by_county: Record<
      string,
      {
        name: string;
        t_min_c: number;
        t_max_c: number;
        summary: string;
        note: string | null;
        t_now_c?: number;
        observed_at?: string;
      }
    >;
  };
  songs: {
    source: string | null;
    chart_date: string | null;
    items: Array<{
      rank: number;
      title: string;
      artist: string;
      url: string;
      isrc?: string;
      provider_ids?: Record<string, string>;
    }>;
    status?: string;
    note?: string;
  };
  prices: Array<{
    key: string;
    label: string;
    value: number;
    unit: string;
    as_of: string;
    source: string;
  }>;
  trends: {
    source: string;
    attribution: string;
    items: TrendItem[];
  };
  missing: string[];
  signature: { alg: "ed25519"; key_id: string; sig: string } | null;
};

const EMPTY_TRENDS: Snapshot["trends"] = {
  source: "Google Trends",
  attribution:
    "Google Trends。依 Google 服務條款使用；再使用時請註明 Google。https://support.google.com/trends/answer/4365538?hl=en",
  items: [],
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function trends(value: unknown): Snapshot["trends"] {
  const record = asRecord(value);
  const items = Array.isArray(record.items) ? record.items : [];
  return {
    source: typeof record.source === "string" ? record.source : EMPTY_TRENDS.source,
    attribution: typeof record.attribution === "string" ? record.attribution : EMPTY_TRENDS.attribution,
    items: items.map((item) => {
      const trend = asRecord(item);
      return {
        rank: Number(trend.rank),
        term: String(trend.term ?? ""),
        url: String(trend.url ?? ""),
      };
    }),
  };
}

function signature(value: unknown): Snapshot["signature"] {
  if (value === null || value === undefined) return null;
  const record = asRecord(value);
  if (record.alg !== "ed25519" || typeof record.key_id !== "string" || typeof record.sig !== "string") {
    return null;
  }
  return { alg: "ed25519", key_id: record.key_id, sig: record.sig };
}

function providerIds(value: unknown): { provider_ids: Record<string, string> } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const ids = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  return { provider_ids: ids };
}

/** Project a document onto known fields. Unknown properties are dropped. */
export function normalizeSnapshot(input: unknown): Snapshot {
  const record = asRecord(input);
  const weather = asRecord(record.weather);
  const songs = asRecord(record.songs);
  const counties = asRecord(weather.by_county);
  const byCounty: Snapshot["weather"]["by_county"] = {};
  for (const [code, raw] of Object.entries(counties)) {
    const county = asRecord(raw);
    byCounty[code] = {
      name: String(county.name ?? ""),
      t_min_c: Number(county.t_min_c),
      t_max_c: Number(county.t_max_c),
      summary: String(county.summary ?? ""),
      note: county.note === null || county.note === undefined ? null : String(county.note),
      ...(typeof county.t_now_c === "number" && Number.isFinite(county.t_now_c) ? { t_now_c: county.t_now_c } : {}),
      ...(typeof county.observed_at === "string" ? { observed_at: county.observed_at } : {}),
    };
  }
  const minor = record.schema_minor === undefined ? 0 : Number(record.schema_minor);
  return {
    schema: typeof record.schema === "string" ? record.schema : SCHEMA_URL,
    schema_version: 1,
    schema_minor: minor,
    region: String(record.region ?? ""),
    date: String(record.date ?? ""),
    generated_at: String(record.generated_at ?? ""),
    weather: {
      source: String(weather.source ?? ""),
      ...(typeof weather.attribution === "string" ? { attribution: weather.attribution } : {}),
      by_county: byCounty,
    },
    songs: {
      source: songs.source === null || songs.source === undefined ? null : String(songs.source),
      chart_date:
        songs.chart_date === null || songs.chart_date === undefined ? null : String(songs.chart_date),
      items: Array.isArray(songs.items)
        ? songs.items.map((item) => {
            const song = asRecord(item);
            return {
              rank: Number(song.rank),
              title: String(song.title ?? ""),
              artist: String(song.artist ?? ""),
              url: String(song.url ?? ""),
              ...(typeof song.isrc === "string" ? { isrc: song.isrc } : {}),
              ...(providerIds(song.provider_ids) ?? {}),
            };
          })
        : [],
      ...(typeof songs.status === "string" ? { status: songs.status } : {}),
      ...(typeof songs.note === "string" ? { note: songs.note } : {}),
    },
    prices: Array.isArray(record.prices)
      ? record.prices.map((item) => {
          const price = asRecord(item);
          return {
            key: String(price.key ?? ""),
            label: String(price.label ?? ""),
            value: Number(price.value),
            unit: String(price.unit ?? ""),
            as_of: String(price.as_of ?? ""),
            source: String(price.source ?? ""),
          };
        })
      : [],
    trends: record.trends === undefined ? { ...EMPTY_TRENDS, items: [] } : trends(record.trends),
    missing: Array.isArray(record.missing) ? record.missing.map((item) => String(item)) : [],
    signature: signature(record.signature),
  };
}

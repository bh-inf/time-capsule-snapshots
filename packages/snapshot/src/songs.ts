import { HttpBytes, safeFetch, scrubSecrets, type OneShot } from "./fetch.ts";
import { cleanText } from "./rss.ts";
import { taipeiParts } from "./time.ts";
import { assertPublicHttpsUrl } from "./url-policy.ts";
import type { Snapshot } from "./normalize.ts";

export const KKBOX_TOKEN_URL = "https://account.kkbox.com/oauth2/token";
export const KKBOX_API = "https://api.kkbox.com/v1.1";
/** Chart playlists are matched by title; their IDs are not documented as stable. */
export const KKBOX_CHART_TITLE = "華語單曲日榜";
export const SONG_LIMIT = 10;

export type KkboxCredentials = { clientId: string; clientSecret: string };

export type SongItem = Snapshot["songs"]["items"][number];

export type SongsResult =
  | { ok: true; value: Pick<Snapshot["songs"], "source" | "chart_date" | "items"> }
  | { ok: false; configured: boolean };

/** Thrown when a 2xx response no longer has the shape we parse. Fails the canary. */
export class SongsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SongsParseError";
  }
}

const ISRC = /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? [...cleanText(value)].slice(0, max).join("") : "";
}

function storeableHttps(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    return assertPublicHttpsUrl(url).toString();
  } catch {
    return null;
  }
}

export function parseKkboxToken(body: string): string {
  let token: unknown;
  try {
    token = asRecord(JSON.parse(body)).access_token;
  } catch {
    throw new SongsParseError("token: not JSON");
  }
  if (typeof token !== "string" || !/^[\x21-\x7e]{8,4096}$/.test(token)) throw new SongsParseError("token: no access_token");
  return token;
}

/** Picks the chart playlist by title from GET /charts. Returns its ID and the Taipei date it was last updated. */
export function parseKkboxCharts(body: string, title = KKBOX_CHART_TITLE): { id: string; updatedDate: string | null } {
  let data: unknown;
  try {
    data = asRecord(JSON.parse(body)).data;
  } catch {
    throw new SongsParseError("charts: not JSON");
  }
  if (!Array.isArray(data) || data.length === 0) throw new SongsParseError("charts: no data");
  const chart = data.map(asRecord).find((item) => cleanText(String(item.title ?? "")) === title);
  if (!chart) throw new SongsParseError(`charts: no ${title}`);
  const id = chart.id;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new SongsParseError("charts: bad id");
  const updated = typeof chart.updated_at === "string" ? new Date(chart.updated_at) : null;
  const updatedDate = updated && Number.isFinite(updated.getTime()) ? taipeiParts(updated).date : null;
  return { id, updatedDate };
}

/** Title, artist, rank, KKBOX link, ISRC and KKBOX track ID only. No images, previews or stream URLs. */
export function parseKkboxTracks(body: string, limit = SONG_LIMIT): SongItem[] {
  let data: unknown;
  try {
    data = asRecord(JSON.parse(body)).data;
  } catch {
    throw new SongsParseError("tracks: not JSON");
  }
  if (!Array.isArray(data)) throw new SongsParseError("tracks: no data");
  const items: SongItem[] = [];
  for (const [index, raw] of data.slice(0, limit).entries()) {
    const track = asRecord(raw);
    const title = text(track.name, 200);
    const artist = text(asRecord(asRecord(track.album).artist).name, 200);
    const url = storeableHttps(track.url);
    if (!title || !artist || !url) continue;
    const isrc = typeof track.isrc === "string" ? track.isrc.trim().toUpperCase() : "";
    const id = typeof track.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(track.id) ? track.id : null;
    items.push({
      rank: index + 1,
      title,
      artist,
      url,
      ...(ISRC.test(isrc) ? { isrc } : {}),
      ...(id ? { provider_ids: { kkbox: id } } : {}),
    });
  }
  if (items.length === 0) throw new SongsParseError("tracks: no usable rows");
  return items;
}

async function get(url: string, token: string, oneShot: OneShot | undefined, secrets: string[]): Promise<HttpBytes> {
  return safeFetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    oneShot,
    secrets,
  });
}

/**
 * KKBOX Open API chart (spec §7.3, §10.4). Runs only when credentials are configured,
 * which is the owner's sign-off that the developer terms allow keeping these fields in the public archive.
 */
export async function collectKkboxSongs(
  credentials: KkboxCredentials | undefined,
  options: { oneShot?: OneShot; snapshotDate: string },
): Promise<SongsResult> {
  const clientId = credentials?.clientId.trim() ?? "";
  const clientSecret = credentials?.clientSecret.trim() ?? "";
  if (!clientId || !clientSecret) return { ok: false, configured: false };
  const secrets = [clientId, clientSecret];
  try {
    const tokenResponse = await safeFetch(KKBOX_TOKEN_URL, {
      postForm: { grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret },
      headers: { accept: "application/json" },
      oneShot: options.oneShot,
      secrets,
    });
    if (tokenResponse.status < 200 || tokenResponse.status >= 300) return { ok: false, configured: true };
    const token = parseKkboxToken(tokenResponse.text());
    secrets.push(token);
    const charts = await get(`${KKBOX_API}/charts?territory=TW&limit=100`, token, options.oneShot, secrets);
    if (charts.status < 200 || charts.status >= 300) return { ok: false, configured: true };
    const chart = parseKkboxCharts(charts.text());
    const tracks = await get(
      `${KKBOX_API}/charts/${encodeURIComponent(chart.id)}/tracks?territory=TW&limit=${SONG_LIMIT}`,
      token,
      options.oneShot,
      secrets,
    );
    if (tracks.status < 200 || tracks.status >= 300) return { ok: false, configured: true };
    return {
      ok: true,
      value: {
        source: `KKBOX ${KKBOX_CHART_TITLE}`,
        chart_date: chart.updatedDate ?? options.snapshotDate,
        items: parseKkboxTracks(tracks.text()),
      },
    };
  } catch (error) {
    if (error instanceof SongsParseError) throw new SongsParseError(scrubSecrets(error.message, secrets));
    return { ok: false, configured: true };
  }
}

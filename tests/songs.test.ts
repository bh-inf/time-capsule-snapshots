import { describe, expect, it } from "vitest";
import { assertWriterSnapshot } from "@time-capsule/schema";
import {
  HttpBytes,
  collectKkboxSongs,
  collectSnapshot,
  normalizeSnapshot,
  safeFetch,
  parseKkboxCharts,
  parseKkboxTracks,
  type OneShot,
} from "@time-capsule/snapshot";

const NOW = new Date("2026-10-16T13:00:00Z");
const CREDS = { clientId: "kkbox-client-id", clientSecret: "kkbox-client-secret" };
const TOKEN = "kkbox-access-token-123";

const CHARTS = JSON.stringify({
  data: [
    { id: "LcJ5xi2mGLgO4AHbw1", title: "西洋單曲日榜", updated_at: "2026-10-16T02:00:00+08:00" },
    { id: "DZrC8m29ciOFY2JAm3", title: "華語單曲日榜", updated_at: "2026-10-16T02:00:00+08:00", images: [{ url: "https://i.kfs.io/cover.jpg" }] },
  ],
});

const TRACKS = JSON.stringify({
  data: [
    {
      id: "Ksn7j-zg8Z0xD4X7Fh",
      name: "第一首",
      isrc: "twa012600001",
      url: "https://www.kkbox.com/tw/tc/song/Ksn7j-zg8Z0xD4X7Fh",
      album: { name: "專輯", images: [{ url: "https://i.kfs.io/album.jpg" }], artist: { name: "歌手甲" } },
    },
    { id: "no-url", name: "沒有連結", album: { artist: { name: "歌手乙" } } },
    {
      id: "8p9Xb2Aa",
      name: "第三首",
      isrc: "not-an-isrc",
      url: "https://www.kkbox.com/tw/tc/song/8p9Xb2Aa",
      album: { artist: { name: "歌手丙" } },
    },
  ],
});

function kkbox(overrides?: { token?: number; charts?: string; tracks?: string }): {
  calls: Array<{ url: string; method: string; body?: string; headers: Record<string, string> }>;
  oneShot: OneShot;
} {
  const calls: Array<{ url: string; method: string; body?: string; headers: Record<string, string> }> = [];
  return {
    calls,
    oneShot: async (url, init) => {
      calls.push({ url, method: init.method ?? "GET", body: init.body, headers: init.headers });
      const ok = (body: string, status = 200) => new HttpBytes(status, { get: () => null }, Buffer.from(body));
      if (url === "https://account.kkbox.com/oauth2/token") {
        return ok(JSON.stringify({ access_token: TOKEN, token_type: "Bearer", expires_in: 2592000 }), overrides?.token ?? 200);
      }
      if (url.startsWith("https://api.kkbox.com/v1.1/charts?")) return ok(overrides?.charts ?? CHARTS);
      if (url.startsWith("https://api.kkbox.com/v1.1/charts/DZrC8m29ciOFY2JAm3/tracks?")) return ok(overrides?.tracks ?? TRACKS);
      if (url.includes("NewOpenData/JSON/154")) return ok(JSON.stringify([{ 標題: "標題" }]));
      if (url.includes("voachinese.com")) return ok("<rss><channel></channel></rss>", 500);
      if (url.includes("/trending/rss")) return ok("", 500);
      if (url.includes("opendata.cwa.gov.tw")) return ok("", 500);
      throw new Error(`unexpected fetch ${url}`);
    },
  };
}

describe("KKBOX songs", () => {
  it("does not touch the network without credentials", async () => {
    const network = kkbox();
    const result = await collectKkboxSongs(undefined, { oneShot: network.oneShot, snapshotDate: "2026-10-16" });
    expect(result).toEqual({ ok: false, configured: false });
    const blank = await collectKkboxSongs({ clientId: " ", clientSecret: "" }, { oneShot: network.oneShot, snapshotDate: "2026-10-16" });
    expect(blank).toEqual({ ok: false, configured: false });
    expect(network.calls).toEqual([]);
  });

  it("keeps rank, title, artist, link, ISRC and KKBOX ID only", async () => {
    const network = kkbox();
    const result = await collectKkboxSongs(CREDS, { oneShot: network.oneShot, snapshotDate: "2026-10-16" });
    expect(result).toEqual({
      ok: true,
      value: {
        source: "KKBOX 華語單曲日榜",
        chart_date: "2026-10-16",
        items: [
          {
            rank: 1,
            title: "第一首",
            artist: "歌手甲",
            url: "https://www.kkbox.com/tw/tc/song/Ksn7j-zg8Z0xD4X7Fh",
            isrc: "TWA012600001",
            provider_ids: { kkbox: "Ksn7j-zg8Z0xD4X7Fh" },
          },
          {
            rank: 3,
            title: "第三首",
            artist: "歌手丙",
            url: "https://www.kkbox.com/tw/tc/song/8p9Xb2Aa",
            provider_ids: { kkbox: "8p9Xb2Aa" },
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain("i.kfs.io");
  });

  it("sends credentials only in the token POST body and the token only in a header", async () => {
    const network = kkbox();
    await collectKkboxSongs(CREDS, { oneShot: network.oneShot, snapshotDate: "2026-10-16" });
    const [token, ...rest] = network.calls;
    expect(token?.method).toBe("POST");
    expect(token?.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(new URLSearchParams(token?.body).get("grant_type")).toBe("client_credentials");
    expect(new URLSearchParams(token?.body).get("client_secret")).toBe(CREDS.clientSecret);
    for (const call of network.calls) {
      expect(call.url).not.toContain(CREDS.clientSecret);
      expect(call.url).not.toContain(TOKEN);
    }
    expect(rest.map((call) => call.method)).toEqual(["GET", "GET"]);
    expect(rest.every((call) => call.headers.authorization === `Bearer ${TOKEN}`)).toBe(true);
  });

  it("reports a configured source that failed without failing the snapshot", async () => {
    const network = kkbox({ token: 401 });
    const result = await collectKkboxSongs(CREDS, { oneShot: network.oneShot, snapshotDate: "2026-10-16" });
    expect(result).toEqual({ ok: false, configured: true });
  });

  it("warns but still publishes the day when KKBOX changes its response shape", async () => {
    const network = kkbox({ charts: JSON.stringify({ data: [{ id: "x", title: "別的榜" }] }) });
    const warnings: string[] = [];
    const snapshot = await collectSnapshot({ now: NOW, kkbox: CREDS, oneShot: network.oneShot, onWarning: (m) => warnings.push(m) });
    expect(warnings).toEqual(["songs parse failed: charts: no 華語單曲日榜"]);
    expect(snapshot.songs).toMatchObject({ items: [], status: "unavailable", note: "排行榜格式改變，這天沒有記錄" });
    expect(snapshot.missing).toContain("songs");
    expect(() => parseKkboxTracks(JSON.stringify({ data: [{ name: "只有歌名" }] }))).toThrow(/no usable rows/);
    expect(() => parseKkboxCharts("<html>")).toThrow(/not JSON/);
  });

  it("fills the snapshot songs section and leaves songs out of missing", async () => {
    const network = kkbox();
    const snapshot = await collectSnapshot({ now: NOW, kkbox: CREDS, oneShot: network.oneShot });
    expect(snapshot.songs.source).toBe("KKBOX 華語單曲日榜");
    expect(snapshot.songs.status).toBe("ok");
    expect(snapshot.songs.items).toHaveLength(2);
    expect(snapshot.missing).not.toContain("songs");
    assertWriterSnapshot(snapshot);
    expect(normalizeSnapshot(JSON.parse(JSON.stringify(snapshot))).songs).toEqual(snapshot.songs);
  });

  it("marks songs unavailable when the configured source fails", async () => {
    const network = kkbox({ token: 500 });
    const snapshot = await collectSnapshot({ now: NOW, kkbox: CREDS, oneShot: network.oneShot });
    expect(snapshot.songs).toMatchObject({ items: [], status: "unavailable", note: "排行榜抓取失敗" });
    expect(snapshot.missing).toContain("songs");
  });

  it("never follows a redirect with the credentials body", async () => {
    const calls: string[] = [];
    const oneShot: OneShot = async (url) => {
      calls.push(url);
      return new HttpBytes(302, { get: (name) => (name === "location" ? "/elsewhere" : null) }, new Uint8Array());
    };
    await expect(
      safeFetch("https://account.kkbox.com/oauth2/token", { postForm: { client_secret: "s" }, oneShot }),
    ).rejects.toThrow(/redirect after POST/);
    expect(calls).toHaveLength(1);
  });

  it("keeps only the top three", () => {
    const rows = [1, 2, 3, 4, 5].map((n) => ({
      id: `id${n}`,
      name: `歌${n}`,
      url: `https://www.kkbox.com/tw/tc/song/id${n}`,
      album: { artist: { name: `歌手${n}` } },
    }));
    expect(parseKkboxTracks(JSON.stringify({ data: rows })).map((song) => song.rank)).toEqual([1, 2, 3]);
  });
});

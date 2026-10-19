import { lstatSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertWriterSnapshot, readerV10Accepts, writerAccepts } from "@time-capsule/schema";
import {
  HttpBytes,
  collectSnapshot,
  findMissingDates,
  isWireService,
  normalizeSnapshot,
  parseCwaForecast,
  parseExecutiveYuanTitles,
  trendsExploreUrl,
  writeSnapshotTree,
  type Snapshot,
} from "@time-capsule/snapshot";

const NOW = new Date("2026-10-16T13:00:00Z");

const EY = JSON.stringify([
  { 標題: "測試標題一", 內容: "秘密內文不要出現", 上版日期: "2026-10-16" },
  { 標題: "測試標題一", 內容: "重複", 上版日期: "2026-10-16" },
  { 標題: "測試標題二", 內容: "也不要出現", 上版日期: "2026-10-16" },
]);

const VOA = `<?xml version="1.0"?><rss><channel>
<item><title>VOA 自製標題</title><link>https://www.voachinese.com/a/original</link><author>chinese@voanews.com (美國之音)</author></item>
<item><title>通訊社標題</title><link>https://www.voachinese.com/a/wire</link><author>chinese@voanews.com (Reuters)</author></item>
<item><title>法新社稿</title><link>https://www.voachinese.com/a/afp</link><author>desk (AFP)</author></item>
<item><title>美联社稿</title><link>https://www.voachinese.com/a/ap</link><source>AP</source></item>
<item><title>Threads 連結</title><link>https://www.threads.net/post/1</link><author>voa</author></item>
</channel></rss>`;

const TRENDS = `<?xml version="1.0"?><rss><channel>
<item><title>測試搜尋</title><link>https://trends.google.com/trending/rss?geo=TW</link>
<ht:news_item><ht:news_item_title>不該保存的新聞</ht:news_item_title></ht:news_item></item>
</channel></rss>`;

const CWA = JSON.stringify({
  records: {
    location: [
      {
        locationName: "臺北市",
        weatherElement: [
          { elementName: "Wx", time: [{ startTime: "2026-10-16 18:00:00", endTime: "2026-10-17 06:00:00", parameter: { parameterName: "多雲" } }] },
          { elementName: "MinT", time: [{ startTime: "2026-10-16 18:00:00", endTime: "2026-10-17 06:00:00", parameter: { parameterName: "21" } }] },
          { elementName: "MaxT", time: [{ startTime: "2026-10-16 18:00:00", endTime: "2026-10-17 06:00:00", parameter: { parameterName: "27" } }] },
        ],
      },
      {
        locationName: "高雄市",
        weatherElement: [
          { elementName: "Wx", time: [{ startTime: "2026-10-16 18:00:00", endTime: "2026-10-17 06:00:00", parameter: { parameterName: "晴" } }] },
          { elementName: "MinT", time: [{ startTime: "2026-10-16 18:00:00", endTime: "2026-10-17 06:00:00", parameter: { parameterName: "24" } }] },
          { elementName: "MaxT", time: [{ startTime: "2026-10-16 18:00:00", endTime: "2026-10-17 06:00:00", parameter: { parameterName: "31" } }] },
        ],
      },
    ],
  },
});

function feeds(overrides?: Record<string, number>): { calls: string[]; headers: Record<string, string>[]; oneShot: (url: string, init: { headers: Record<string, string> }) => Promise<HttpBytes> } {
  const calls: string[] = [];
  const headers: Record<string, string>[] = [];
  return {
    calls,
    headers,
    oneShot: async (url, init) => {
      calls.push(url);
      headers.push(init.headers);
      const status = overrides?.[url] ?? 200;
      let body = "";
      if (url.includes("NewOpenData/JSON/154")) body = EY;
      else if (url.includes("voachinese.com")) body = VOA;
      else if (url.includes("/trending/rss")) body = TRENDS;
      else if (url.includes("opendata.cwa.gov.tw")) body = CWA;
      else throw new Error(`unexpected fetch ${url}`);
      return new HttpBytes(status, { get: () => null }, Buffer.from(body));
    },
  };
}

describe("collector", () => {
  it("keeps titles and links, filters wire copy, and does not fetch explore or threads", async () => {
    const network = feeds();
    const snapshot = await collectSnapshot({
      now: NOW,
      cwaApiKey: "cwa-test-key",
      oneShot: network.oneShot,
    });
    expect(snapshot.news.taiwan.map((item) => item.title)).toEqual(["測試標題一", "測試標題二"]);
    expect(JSON.stringify(snapshot)).not.toContain("秘密內文不要出現");
    expect(snapshot.news.world.map((item) => item.title)).toEqual(["VOA 自製標題"]);
    expect(snapshot.news.filtered_wire_services).toBe(3);
    expect(snapshot.news.attributions.map((item) => item.source)).toEqual(["行政院", "VOA"]);
    expect(snapshot.news.attributions[0]?.license).toContain("政府資料開放授權條款－第1版");
    expect(snapshot.trends.items).toEqual([
      {
        rank: 1,
        term: "測試搜尋",
        url: trendsExploreUrl("測試搜尋", "TW"),
      },
    ]);
    expect(snapshot.trends.attribution).toContain("Google");
    expect(JSON.stringify(snapshot.trends)).not.toContain("不該保存的新聞");
    expect(snapshot.weather.by_county.TPE).toMatchObject({ t_min_c: 21, t_max_c: 27, summary: "多雲" });
    expect(snapshot.weather.by_county.KHH?.name).toBe("高雄市");
    expect(snapshot.songs.status).toBe("unavailable");
    expect(snapshot.missing).toEqual(expect.arrayContaining(["prices", "songs"]));
    expect(snapshot.schema_version).toBe(1);
    expect(snapshot.schema_minor).toBe(1);
    expect(network.calls.some((url) => url.includes("/trends/explore") || url.includes("/explore?"))).toBe(false);
    expect(network.calls.some((url) => url.includes("threads"))).toBe(false);
    const cwa = network.headers.find((header) => header.authorization === "cwa-test-key");
    expect(cwa).toBeTruthy();
    expect(network.calls.some((url) => url.includes("cwa-test-key"))).toBe(false);
    assertWriterSnapshot(snapshot);
  });

  it("does not publish when every network source fails", async () => {
    const network = feeds({
      "https://www.ey.gov.tw/NewOpenData/JSON/154": 500,
      "https://www.voachinese.com/api/zm_yql-vomx-tpeybti": 500,
      "https://trends.google.com/trending/rss?geo=TW": 500,
      "https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001?format=JSON": 500,
    });
    await expect(collectSnapshot({ now: NOW, cwaApiKey: "cwa-test-key", oneShot: network.oneShot })).rejects.toThrow(/all network sources/);
  });

  it("requires the weather key when the schedule requires a signature", async () => {
    await expect(collectSnapshot({ now: NOW, requireConfiguredSources: true, oneShot: feeds().oneShot })).rejects.toThrow(/CWA_API_KEY/);
  });

  it("builds trend links from the region instead of a schema constant", () => {
    expect(trendsExploreUrl("雨", "JP")).toBe("https://trends.google.com/trends/explore?q=%E9%9B%A8&geo=JP");
    expect(isWireService("AP")).toBe(true);
    expect(parseExecutiveYuanTitles(EY)).toEqual(["測試標題一", "測試標題一", "測試標題二"]);
    expect(parseCwaForecast(CWA, NOW).TPE?.summary).toBe("多雲");
  });
});

describe("archive writes", () => {
  it("refuses to replace an archived date or follow a symlink", () => {
    const root = mkdtempSync(join(tmpdir(), "snapshot-archive-"));
    const snapshot = {
      schema_version: 1,
      region: "TW",
      date: "2026-10-18",
    } as Snapshot;
    const first = writeSnapshotTree({ repoRoot: root, snapshot: { ...snapshot, generated_at: "a" } as Snapshot });
    expect(first.wroteDate).toBe(true);
    const again = writeSnapshotTree({ repoRoot: root, snapshot: { ...snapshot, generated_at: "b" } as Snapshot });
    expect(again.wroteDate).toBe(false);
    expect(readFileSync(join(root, first.datePath), "utf8")).toContain('"generated_at": "a"');
    const linkRoot = mkdtempSync(join(tmpdir(), "snapshot-link-"));
    const real = join(linkRoot, "real.json");
    writeFileSync(real, "{}\n");
    mkdirSync(join(linkRoot, "v1", "TW", "2026"), { recursive: true });
    symlinkSync(real, join(linkRoot, "v1", "TW", "2026", "2026-10-18.json"));
    expect(lstatSync(join(linkRoot, "v1", "TW", "2026", "2026-10-18.json")).isSymbolicLink()).toBe(true);
    expect(() => writeSnapshotTree({ repoRoot: linkRoot, snapshot })).toThrow(/non-regular/);
  });
});

describe("compatibility", () => {
  it("lets a new reader accept a minor-0 document and an old reader accept trends", () => {
    const minor0 = JSON.parse(readFileSync("fixtures/snapshot/v1/2026-10-16.json", "utf8"));
    const expected = JSON.parse(readFileSync("fixtures/snapshot/v1/expected/2026-10-16.json", "utf8"));
    expect(writerAccepts(minor0)).toBe(true);
    expect(readerV10Accepts(minor0)).toBe(true);
    expect(normalizeSnapshot(minor0)).toEqual(expected);
    const minor1 = JSON.parse(readFileSync("fixtures/snapshot/v1/schema-minor-1.json", "utf8"));
    expect(minor1.trends.items[0].url).not.toContain("geo=TW");
    expect(writerAccepts(minor1)).toBe(true);
    expect(readerV10Accepts(minor1)).toBe(true);
    const normalized = normalizeSnapshot(minor1);
    expect(JSON.stringify(normalized)).not.toContain("news_title_not_stored");
    expect(JSON.stringify(normalized)).not.toContain("note_for_future_readers");
    expect(JSON.stringify(normalized)).not.toContain("body_not_stored");
    expect(normalized.trends.items[0]?.url).toContain("geo=JP");
    expect(normalized.schema_minor).toBe(1);
  });

  it("reports missing dates inside a published span", () => {
    expect(findMissingDates(["2026-10-16", "2026-10-18"], "2026-10-16", "2026-10-18")).toEqual(["2026-10-17"]);
  });
});

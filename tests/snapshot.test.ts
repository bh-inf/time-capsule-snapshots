import { lstatSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertWriterSnapshot, readerV10Accepts, writerAccepts } from "@time-capsule/schema";
import {
  HttpBytes,
  collectSnapshot,
  findMissingDates,
  hasSimplifiedChinese,
  toTraditionalChinese,
  isWireService,
  normalizeSnapshot,
  parseCwaForecast,
  parseCwaObservation,
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
<item><title>调查报告：中俄防务合作加速升级</title><link>https://www.voachinese.com/a/simplified</link><author>voa</author></item>
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

function station(county: string, temp: unknown, weather: unknown, time = "2026-10-16T21:00:00+08:00", altitude: unknown = "12.0") {
  return {
    StationName: "測站",
    GeoInfo: { CountyName: county, StationAltitude: altitude },
    ObsTime: { DateTime: time },
    WeatherElement: { AirTemperature: temp, Weather: weather },
  };
}

const CWA_OBS = JSON.stringify({
  records: {
    Station: [
      station("臺北市", "24.0", "陰"),
      station("臺北市", 25.4, "陰", "2026-10-16T21:10:00+08:00"),
      station("臺北市", "-99", "-99"),
      station("臺北市", "X", "X"),
      station("臺北市", "11.0", "晴", "2026-10-16T21:10:00+08:00", "3952.0"),
      station("臺北市", "26.0", "多雲"),
      station("高雄市", "29.5", "晴"),
      station("花蓮縣", "22.0", "雨"),
      station("不存在市", "30.0", "晴"),
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
      else if (url.includes("O-A0003-001")) body = overrides?.["observation-missing"] ? "{}" : CWA_OBS;
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
    expect(snapshot.news.world.map((item) => item.title)).toEqual(["VOA 自製標題", "調查報告：中俄防務合作加速升級"]);
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
    expect(snapshot.weather.by_county.TPE).toMatchObject({ t_min_c: 21, t_max_c: 27, summary: "陰", t_now_c: 25.4 });
    expect(snapshot.weather.by_county.KHH?.name).toBe("高雄市");
    expect(snapshot.songs.status).toBe("unavailable");
    expect(snapshot.missing).toEqual(expect.arrayContaining(["prices", "songs"]));
    expect(snapshot.schema_version).toBe(1);
    expect(snapshot.schema_minor).toBe(2);
    expect(snapshot.weather.by_county.TPE).toMatchObject({ t_now_c: 25.4, summary: "陰", observed_at: "2026-10-16T21:10:00+08:00" });
    expect(snapshot.weather.by_county.KHH).toMatchObject({ t_now_c: 29.5, summary: "晴", t_min_c: 24, t_max_c: 31 });
    expect(network.calls.some((url) => url.includes("O-A0003-001"))).toBe(true);
    expect(network.calls.some((url) => url.includes("cwa-test-key"))).toBe(false);
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

  it("keeps the forecast when the observation cannot be read, and says so", async () => {
    const warnings: string[] = [];
    const snapshot = await collectSnapshot({
      now: NOW,
      cwaApiKey: "cwa-test-key",
      oneShot: feeds({ "observation-missing": 1 }).oneShot,
      onWarning: (message) => warnings.push(message),
    });
    expect(snapshot.weather.by_county.TPE).toMatchObject({ t_min_c: 21, t_max_c: 27, summary: "多雲" });
    expect(snapshot.weather.by_county.TPE).not.toHaveProperty("t_now_c");
    expect(warnings.some((message) => message.startsWith("weather observation failed"))).toBe(true);
    assertWriterSnapshot(snapshot);
  });

  it("reads the current temperature and weather word per county from the observation report", () => {
    const observed = parseCwaObservation(CWA_OBS);
    expect(observed["TPE"]).toEqual({ t_now_c: 25.4, summary: "陰", observed_at: "2026-10-16T21:10:00+08:00" });
    expect(observed["KHH"]).toEqual({ t_now_c: 29.5, summary: "晴", observed_at: "2026-10-16T21:00:00+08:00" });
    expect(observed["HUA"]?.t_now_c).toBe(22);
    expect(Object.keys(observed).sort()).toEqual(["HUA", "KHH", "TPE"]);
    expect(() => parseCwaObservation("{}")).toThrow(/stations/);
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

  it("accepts a county without a current reading, and a reader of the minor-1 schema accepts one with it", () => {
    const base = JSON.parse(readFileSync("fixtures/snapshot/v1/schema-minor-1.json", "utf8"));
    Object.assign(base, {
      schema: "https://bh-inf.github.io/time-capsule-snapshots/v1/schema/snapshot-v1.2.json",
      schema_minor: 2,
    });
    base.weather.by_county = { TPE: { name: "臺北市", t_min_c: 21, t_max_c: 27, summary: "陰", note: null } };
    expect(writerAccepts(base)).toBe(true);
    const withNow = structuredClone(base);
    Object.assign(withNow.weather.by_county.TPE, { t_now_c: 25.4, observed_at: "2026-10-16T21:10:00+08:00" });
    expect(writerAccepts(withNow)).toBe(true);
    expect(readerV10Accepts(withNow)).toBe(true);
    Object.assign(withNow.weather.by_county.TPE, { observed_at: "yesterday" });
    expect(writerAccepts(withNow)).toBe(false);
    expect(normalizeSnapshot(withNow).weather.by_county["TPE"]?.t_now_c).toBe(25.4);
  });
});

describe("archive writes", () => {
  const base = { schema_version: 1, region: "TW", date: "2026-10-18", missing: [] as string[] };
  const make = (generatedAt: string, title: string, missing: string[] = []) =>
    ({ ...base, generated_at: generatedAt, missing, news: { taiwan: [{ title, fetched_at: generatedAt }] }, signature: { value: generatedAt } }) as unknown as Snapshot;
  const read = (root: string, path: string) => JSON.parse(readFileSync(join(root, path), "utf8"));

  it("replaces the newest day with a later run that changed", () => {
    const root = mkdtempSync(join(tmpdir(), "snapshot-archive-"));
    const first = writeSnapshotTree({ repoRoot: root, snapshot: make("2026-10-18T09:30:00+08:00", "甲") });
    expect(first.wroteDate).toBe(true);
    const same = writeSnapshotTree({ repoRoot: root, snapshot: make("2026-10-18T10:30:00+08:00", "甲") });
    expect(same.wroteDate).toBe(false);
    expect(read(root, first.datePath).generated_at).toBe("2026-10-18T09:30:00+08:00");
    const changed = writeSnapshotTree({ repoRoot: root, snapshot: make("2026-10-18T11:30:00+08:00", "乙") });
    expect(changed.wroteDate).toBe(true);
    expect(read(root, first.datePath).news.taiwan[0].title).toBe("乙");
  });

  it("keeps the stored copy for an older run, a run that lost a section, or a past day", () => {
    const root = mkdtempSync(join(tmpdir(), "snapshot-archive-"));
    const first = writeSnapshotTree({ repoRoot: root, snapshot: make("2026-10-18T09:30:00+08:00", "甲") });
    expect(writeSnapshotTree({ repoRoot: root, snapshot: make("2026-10-18T08:30:00+08:00", "乙") }).wroteDate).toBe(false);
    expect(writeSnapshotTree({ repoRoot: root, snapshot: make("2026-10-18T10:30:00+08:00", "乙", ["weather"]) }).wroteDate).toBe(false);
    const next = { ...make("2026-10-19T09:30:00+08:00", "丙"), date: "2026-10-19" } as Snapshot;
    expect(writeSnapshotTree({ repoRoot: root, snapshot: next }).wroteDate).toBe(true);
    expect(writeSnapshotTree({ repoRoot: root, snapshot: make("2026-10-18T23:30:00+08:00", "乙") }).wroteDate).toBe(false);
    expect(read(root, first.datePath).news.taiwan[0].title).toBe("甲");
  });

  it("refuses to follow a symlink", () => {
    const linkRoot = mkdtempSync(join(tmpdir(), "snapshot-link-"));
    const real = join(linkRoot, "real.json");
    writeFileSync(real, "{}\n");
    mkdirSync(join(linkRoot, "v1", "TW", "2026"), { recursive: true });
    symlinkSync(real, join(linkRoot, "v1", "TW", "2026", "2026-10-18.json"));
    expect(lstatSync(join(linkRoot, "v1", "TW", "2026", "2026-10-18.json")).isSymbolicLink()).toBe(true);
    expect(() => writeSnapshotTree({ repoRoot: linkRoot, snapshot: make("2026-10-18T09:30:00+08:00", "甲") })).toThrow(/non-regular/);
  });
});

describe("simplified Chinese", () => {
  it("is detected by characters that traditional text does not use", () => {
    expect(hasSimplifiedChinese("调查报告：中俄防务合作")).toBe(true);
    expect(hasSimplifiedChinese("視導薔琵颱風中央災害應變中心")).toBe(false);
    expect(hasSimplifiedChinese("台灣 2026 AI 後端")).toBe(false);
    expect(toTraditionalChinese("调查报告：中俄防务合作加速升级")).toBe("調查報告：中俄防務合作加速升級");
    expect(hasSimplifiedChinese(toTraditionalChinese("台湾政府严厉谴责中国跨境镇压伤害台湾公民"))).toBe(false);
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

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HttpBytes,
  assertPublicAddresses,
  assertPublicHttpsUrl,
  createPublicLookup,
  decodeXmlEntities,
  isBlockedAddress,
  isThreadsHost,
  isWireService,
  parseRssItems,
  redactUrl,
  safeFetch,
  scrubSecrets,
} from "@time-capsule/snapshot";

function callbackLookup(
  addresses: Array<{ address: string; family: number }>,
): ReturnType<typeof createPublicLookup> {
  return createPublicLookup((_hostname, done) => {
    done(null, addresses);
  });
}

function lookupError(hostname: string, addresses: Array<{ address: string; family: number }>): Promise<Error | null> {
  const lookup = callbackLookup(addresses);
  return new Promise((resolve) => {
    lookup(hostname, {}, (err) => resolve(err));
  });
}

describe("public addresses", () => {
  it("rejects loopback, private, link-local, CGNAT, ULA, and mapped addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "192.168.1.1",
      "172.16.0.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "255.255.255.255",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:8.8.8.8",
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
    expect(isBlockedAddress("1.1.1.1")).toBe(false);
    expect(isBlockedAddress("2001:4860:4860::8888")).toBe(false);
  });

  it("refuses a public name that resolves to loopback", async () => {
    for (const host of ["127.0.0.1.nip.io", "localtest.me"]) {
      const error = await lookupError(host, [{ address: "127.0.0.1", family: 4 }]);
      expect(error?.message).toMatch(/non-public/);
    }
  });

  it("pins the first public address and refuses a mixed answer", async () => {
    const lookup = callbackLookup([
      { address: "1.1.1.1", family: 4 },
      { address: "8.8.8.8", family: 4 },
    ]);
    const pinned = await new Promise<unknown>((resolve, reject) => {
      lookup("example.com", { all: true }, (err, addresses) => (err ? reject(err) : resolve(addresses)));
    });
    expect(pinned).toEqual([{ address: "1.1.1.1", family: 4 }]);
    expect(() => assertPublicAddresses(["1.1.1.1", "10.0.0.1"])).toThrow(/non-public/);
    await expect(lookupError("example.com", [
      { address: "1.1.1.1", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ])).resolves.toMatchObject({ message: expect.stringMatching(/non-public/) });
  });
});

describe("url policy", () => {
  it("blocks threads, ip literals, userinfo, and local names", () => {
    expect(() => assertPublicHttpsUrl("https://THREADS.COM/a")).toThrow(/threads/);
    expect(() => assertPublicHttpsUrl("https://threads.com./a")).toThrow(/threads/);
    expect(() => assertPublicHttpsUrl("https://www.threads.net/a")).toThrow(/threads/);
    expect(() => assertPublicHttpsUrl("https://graph.threads.net/a")).toThrow(/threads/);
    expect(() => assertPublicHttpsUrl("https://ｔｈｒｅａｄｓ.com/a")).toThrow(/threads/);
    expect(() => assertPublicHttpsUrl("https://127.0.0.1/a")).toThrow(/ip literal/);
    expect(() => assertPublicHttpsUrl("https://0x7f.0.0.1/a")).toThrow(/ip literal/);
    expect(() => assertPublicHttpsUrl("https://2130706433/a")).toThrow(/ip literal/);
    expect(() => assertPublicHttpsUrl("https://user:pass@example.com/a")).toThrow(/userinfo/);
    expect(() => assertPublicHttpsUrl("http://example.com/a")).toThrow(/https/);
    expect(() => assertPublicHttpsUrl("https://localhost/a")).toThrow(/local/);
    expect(() => assertPublicHttpsUrl("https://printer.local/a")).toThrow(/local/);
    expect(() => assertPublicHttpsUrl("https://metadata.google.internal/a")).toThrow(/local/);
    expect(isThreadsHost("threads.com.evil.example")).toBe(false);
    expect(assertPublicHttpsUrl("https://threads.com.evil.example/a").hostname).toBe("threads.com.evil.example");
  });
});

describe("redirects", () => {
  function shot(map: Record<string, { status: number; location?: string }>) {
    const calls: string[] = [];
    return {
      calls,
      oneShot: async (url: string) => {
        calls.push(url);
        const found = map[url];
        if (!found) throw new Error(`unexpected ${url}`);
        return new HttpBytes(found.status, { get: (name) => (name === "location" ? found.location ?? null : null) }, new Uint8Array());
      },
    };
  }

  it("rejects a redirect that changes port or host", async () => {
    const port = shot({
      "https://example.com/a": { status: 302, location: "https://example.com:8443/b" },
    });
    await expect(safeFetch("https://example.com/a", { oneShot: port.oneShot })).rejects.toThrow(/port/);
    expect(port.calls).toEqual(["https://example.com/a"]);

    const host = shot({
      "https://example.com/a": { status: 302, location: "https://evil.example/b" },
    });
    await expect(safeFetch("https://example.com/a", { oneShot: host.oneShot })).rejects.toThrow(/host or port/);
    expect(host.calls).toEqual(["https://example.com/a"]);
  });

  it("allows two same-origin hops and stops on the third", async () => {
    const ok = shot({
      "https://example.com/a": { status: 302, location: "https://example.com/b" },
      "https://example.com/b": { status: 302, location: "https://example.com:443/c" },
      "https://example.com/c": { status: 200 },
    });
    const response = await safeFetch("https://example.com/a", { oneShot: ok.oneShot });
    expect(response.status).toBe(200);
    expect(ok.calls).toHaveLength(3);

    const tooMany = shot({
      "https://example.com/a": { status: 302, location: "/b" },
      "https://example.com/b": { status: 302, location: "/c" },
      "https://example.com/c": { status: 302, location: "/d" },
    });
    await expect(safeFetch("https://example.com/a", { oneShot: tooMany.oneShot })).rejects.toThrow(/redirect/);
  });
});

describe("rss", () => {
  it("decodes entities once and strips tags", () => {
    expect(decodeXmlEntities("&amp;lt;")).toBe("&lt;");
    expect(decodeXmlEntities("&lt;img onerror=alert(1)&gt;")).toBe("<img onerror=alert(1)>");
    const [item] = parseRssItems(
      "<rss><item><title>&lt;img onerror=alert(1)&gt; 標題</title><link>https://example.com/a</link><author>desk</author></item></rss>",
    );
    expect(item?.title.includes("<")).toBe(false);
    expect(item?.title.includes(">")).toBe(false);
    expect(item?.title).toContain("標題");
  });

  it("scans an unclosed item in linear time", () => {
    const xml = `<rss><item>${"a".repeat(400_000)}`;
    const started = Date.now();
    expect(parseRssItems(xml, 5)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("wire services", () => {
  it("drops AP, Reuters, and AFP without dropping unrelated titles", () => {
    expect(isWireService("chinese@voanews.com (AP)", "", "某標題")).toBe(true);
    expect(isWireService("(Reuters)", "", "某標題")).toBe(true);
    expect(isWireService("AFP", "", "某標題")).toBe(true);
    expect(isWireService("", "Associated Press", "")).toBe(true);
    expect(isWireService("", "", "路透：某事")).toBe(true);
    expect(isWireService("", "", "法新社：某事")).toBe(true);
    expect(isWireService("", "", "美联社：某事")).toBe(true);
    expect(isWireService("chinese@voanews.com (美國之音)", "", "Apple 發布新產品")).toBe(false);
  });
});

describe("secret scrubbing", () => {
  it("removes query credentials and hex material", () => {
    expect(redactUrl("https://example.com/a?Authorization=cwa-secret&x=1")).not.toContain("cwa-secret");
    const secret = "a".repeat(64);
    expect(scrubSecrets(`failed ${secret}`, [secret])).not.toContain(secret);
  });

  it("does not commit secret values", () => {
    const example = readFileSync(".env.example", "utf8");
    expect(example).not.toMatch(/=[0-9A-Za-z]{16,}/);
    const workflow = readFileSync(".github/workflows/snapshot.yml", "utf8");
    expect(workflow).not.toMatch(/CWA_API_KEY:\s*["']?[A-Za-z0-9]{8,}/);
  });
});

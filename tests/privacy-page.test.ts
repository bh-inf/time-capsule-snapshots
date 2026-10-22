import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync("privacy/index.html", "utf8");

describe("privacy policy page", () => {
  it("is one self-contained page", () => {
    expect(html).toContain('<html lang="zh-Hant-TW">');
    expect(html).not.toMatch(/<script|<link|<img|<iframe|src=/i);
  });

  it("names no repository but this one", () => {
    expect(html).not.toMatch(/time-capsule(?!-snapshots)/);
  });
});

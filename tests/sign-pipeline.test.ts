import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { publicKeyFromHex, verifySnapshotSignature } from "@time-capsule/snapshot";
import { runSign } from "../pipeline/snapshot/src/sign-main.ts";

const repo = join(import.meta.dirname, "..");

function keys(): { seedHex: string; publicHex: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" });
  const spki = publicKey.export({ format: "der", type: "spki" });
  return { seedHex: pkcs8.subarray(pkcs8.length - 32).toString("hex"), publicHex: spki.subarray(spki.length - 32).toString("hex") };
}

function newestPublished(): Record<string, unknown> {
  const years = readdirSync(join(repo, "v1", "TW")).filter((name) => /^\d{4}$/.test(name)).sort();
  const dir = join(repo, "v1", "TW", years.at(-1) as string);
  const file = readdirSync(dir).sort().at(-1) as string;
  return JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, unknown>;
}

describe("signing step apart from the collector", () => {
  it("signs an unsigned snapshot and writes only the date file and the index", () => {
    const pair = keys();
    const root = mkdtempSync(join(tmpdir(), "sign-root-"));
    const out = mkdtempSync(join(tmpdir(), "sign-out-"));
    mkdirSync(join(root, "v1", "keys"), { recursive: true });
    writeFileSync(join(root, "v1", "keys", "2030-01.hex"), `${pair.publicHex}\n`);
    const unsigned = { ...newestPublished(), signature: null, date: "2030-01-15" };
    const input = join(mkdtempSync(join(tmpdir(), "sign-in-")), "unsigned.json");
    writeFileSync(input, JSON.stringify(unsigned));
    const { date } = runSign(
      { SNAPSHOT_UNSIGNED_FILE: input, SNAPSHOT_SIGNING_KEY_HEX: pair.seedHex, SNAPSHOT_SIGNING_KEY_ID: "2030-01", SNAPSHOT_OUTPUT_DIR: out },
      root,
    );
    expect(date).toBe("2030-01-15");
    const written = JSON.parse(readFileSync(join(out, "v1", "TW", "2030", "2030-01-15.json"), "utf8")) as Record<string, unknown>;
    expect(verifySnapshotSignature(written, publicKeyFromHex(pair.publicHex))).toBe(true);
    expect(readdirSync(join(out, "v1", "TW")).sort()).toEqual(["2030", "index.json"]);
  });

  it("refuses a snapshot that is already signed, an empty key, and a missing input", () => {
    const pair = keys();
    const root = mkdtempSync(join(tmpdir(), "sign-root-"));
    mkdirSync(join(root, "v1", "keys"), { recursive: true });
    writeFileSync(join(root, "v1", "keys", "2030-01.hex"), `${pair.publicHex}\n`);
    const input = join(mkdtempSync(join(tmpdir(), "sign-in-")), "published.json");
    writeFileSync(input, JSON.stringify(newestPublished()));
    const env = { SNAPSHOT_UNSIGNED_FILE: input, SNAPSHOT_SIGNING_KEY_HEX: pair.seedHex, SNAPSHOT_SIGNING_KEY_ID: "2030-01" };
    expect(() => runSign(env, root)).toThrow(/unsigned/);
    writeFileSync(input, JSON.stringify({ ...newestPublished(), signature: null }));
    expect(() => runSign({ ...env, SNAPSHOT_SIGNING_KEY_HEX: "" }, root)).toThrow(/signing key is required/);
    expect(() => runSign({}, root)).toThrow(/SNAPSHOT_UNSIGNED_FILE/);
  });
});

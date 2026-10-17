import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "@time-capsule/schema";
import {
  assertKeyId,
  privateKeyFromMaterial,
  publicKeyFromHex,
  signSnapshot,
  verifySnapshotSignature,
} from "@time-capsule/snapshot";

function ed25519Material(): { seedHex: string; publicHex: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" });
  const spki = publicKey.export({ format: "der", type: "spki" });
  return {
    seedHex: pkcs8.subarray(pkcs8.length - 32).toString("hex"),
    publicHex: spki.subarray(spki.length - 32).toString("hex"),
  };
}

const document = {
  schema: "https://example.com/schema",
  schema_version: 1,
  region: "TW",
  date: "2026-10-18",
  signature: null as null,
};

describe("signing", () => {
  it("requires an ed25519 key id and verifies with the published public key", () => {
    const keys = ed25519Material();
    expect(() => assertKeyId(undefined)).toThrow(/required/);
    expect(() => assertKeyId("")).toThrow(/required/);
    expect(() => signSnapshot(document, { requireSignature: true, keyHex: keys.seedHex })).toThrow(/KEY_ID/);
    const signed = signSnapshot(document, {
      requireSignature: true,
      keyHex: keys.seedHex,
      keyId: "2026-10",
      publicKeyHex: keys.publicHex,
    });
    expect(signed.signature).toMatchObject({ alg: "ed25519", key_id: "2026-10" });
    expect(verifySnapshotSignature(signed, publicKeyFromHex(keys.publicHex))).toBe(true);
    const wrong = ed25519Material();
    expect(() =>
      signSnapshot(document, {
        requireSignature: true,
        keyHex: keys.seedHex,
        keyId: "2026-10",
        publicKeyHex: wrong.publicHex,
      }),
    ).toThrow(/did not verify/);
  });

  it("fails the scheduled path instead of publishing signature null", () => {
    expect(() => signSnapshot(document, { requireSignature: true })).toThrow(/signature null/);
    expect(signSnapshot(document, { requireSignature: false }).signature).toBeNull();
  });

  it("rejects RSA and EC keys instead of labeling them ed25519", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
      format: "der",
      type: "pkcs8",
    }) as Buffer;
    expect(() => privateKeyFromMaterial(rsa.toString("hex"))).toThrow(/ed25519/);
    const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({
      format: "der",
      type: "pkcs8",
    }) as Buffer;
    expect(() => privateKeyFromMaterial(ec.toString("hex"))).toThrow(/ed25519/);
  });

  it("reads the public key from v1/keys and has no default key id", () => {
    const keys = ed25519Material();
    const root = mkdtempSync(join(tmpdir(), "snapshot-keys-"));
    mkdirSync(join(root, "v1", "keys"), { recursive: true });
    writeFileSync(join(root, "v1", "keys", "2026-10.hex"), `${keys.publicHex}\n`);
    const signed = signSnapshot(document, {
      requireSignature: true,
      keyHex: keys.seedHex,
      keyId: "2026-10",
      repoRoot: root,
    });
    expect(signed.signature?.key_id).toBe("2026-10");
    expect(() =>
      signSnapshot(document, {
        requireSignature: true,
        keyHex: keys.seedHex,
        keyId: "2026-11",
        repoRoot: root,
      }),
    ).toThrow(/missing/);
    const source = readFileSync("packages/snapshot/src/sign.ts", "utf8") + readFileSync("pipeline/snapshot/src/main.ts", "utf8");
    expect(source).not.toMatch(/2026-01/);
    const bytes = canonicalJson({ ...document, signature: undefined });
    expect(bytes.includes("signature")).toBe(false);
  });
});

import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "@time-capsule/schema";
import { scrubSecrets } from "./fetch.ts";

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const KEY_ID_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

export function assertKeyId(value: string | undefined): string {
  const keyId = value?.trim() ?? "";
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new Error("SNAPSHOT_SIGNING_KEY_ID is required and must look like YYYY-MM");
  }
  return keyId;
}

export function scrubKeyError(error: unknown, material: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(scrubSecrets(message, [material]));
}

export function privateKeyFromMaterial(material: string): KeyObject {
  const hex = material.trim();
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("signing key must be hex");
  }
  const raw = Buffer.from(hex, "hex");
  const pkcs8 = raw.length === 32 ? Buffer.concat([ED25519_PKCS8_PREFIX, raw]) : raw;
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  } catch (error) {
    throw scrubKeyError(error, hex);
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("signing key must be ed25519");
  }
  return key;
}

export function publicKeyFromHex(hexText: string): KeyObject {
  const hex = hexText.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("public key file must contain 32-byte ed25519 hex");
  }
  const spki = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(hex, "hex")]);
  const key = createPublicKey({ key: spki, format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("public key must be ed25519");
  }
  return key;
}

export function signingBytes(snapshot: Record<string, unknown>): Buffer {
  const copy: Record<string, unknown> = { ...snapshot };
  delete copy.signature;
  return Buffer.from(canonicalJson(copy), "utf8");
}

export function verifySnapshotSignature(
  snapshot: Record<string, unknown>,
  publicKey: KeyObject,
): boolean {
  const signature = snapshot.signature;
  if (!signature || typeof signature !== "object") return false;
  const sig = (signature as { sig?: unknown }).sig;
  const alg = (signature as { alg?: unknown }).alg;
  if (alg !== "ed25519" || typeof sig !== "string") return false;
  return cryptoVerify(null, signingBytes(snapshot), publicKey, Buffer.from(sig, "base64"));
}

export type SignOptions = {
  requireSignature: boolean;
  keyHex?: string;
  keyId?: string;
  repoRoot?: string;
  publicKeyHex?: string;
};

export function signSnapshot<T extends Record<string, unknown>>(
  snapshot: T,
  options: SignOptions,
): Omit<T, "signature"> & { signature: { alg: "ed25519"; key_id: string; sig: string } | null } {
  const keyHex = options.keyHex?.trim() ?? "";
  if (!keyHex) {
    if (options.requireSignature) {
      throw new Error("signing key is required; refusing to publish signature null");
    }
    return { ...snapshot, signature: null };
  }
  const keyId = assertKeyId(options.keyId);
  const privateKey = privateKeyFromMaterial(keyHex);
  const payload = signingBytes(snapshot);
  const sig = cryptoSign(null, payload, privateKey).toString("base64");
  const signed = {
    ...snapshot,
    signature: { alg: "ed25519" as const, key_id: keyId, sig },
  };
  const publicHex = options.publicKeyHex ?? readPublishedPublicKey(options.repoRoot, keyId);
  const publicKey = publicKeyFromHex(publicHex);
  if (!verifySnapshotSignature(signed, publicKey)) {
    throw new Error("signature did not verify with the published public key");
  }
  return signed;
}

export function readPublishedPublicKey(repoRoot: string | undefined, keyId: string): string {
  if (!repoRoot) throw new Error(`public key v1/keys/${keyId}.hex is not available`);
  const path = join(repoRoot, "v1", "keys", `${assertKeyId(keyId)}.hex`);
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(`public key file v1/keys/${keyId}.hex is missing`);
  }
}

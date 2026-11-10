import { assertWriterSnapshot } from "@time-capsule/schema";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeSnapshotTree } from "../../../packages/snapshot/src/publish.ts";
import { signSnapshot } from "../../../packages/snapshot/src/sign.ts";

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * The only step that holds the signing key. It runs under plain node, imports only the signer, the tree writer and the
 * schema check, and reads one unsigned snapshot written by the collect job, so no collector or feed-parsing code runs
 * beside the key.
 */
export function runSign(env: NodeJS.ProcessEnv, repoRoot: string = defaultRoot): { date: string } {
  const input = env.SNAPSHOT_UNSIGNED_FILE;
  if (!input) throw new Error("SNAPSHOT_UNSIGNED_FILE is required");
  const unsigned = JSON.parse(readFileSync(input, "utf8")) as Record<string, unknown>;
  if (unsigned === null || typeof unsigned !== "object" || unsigned.signature !== null) {
    throw new Error("the collected snapshot must be unsigned");
  }
  assertWriterSnapshot(unsigned);
  const signed = signSnapshot(unsigned, {
    requireSignature: true,
    keyHex: env.SNAPSHOT_SIGNING_KEY_HEX,
    keyId: env.SNAPSHOT_SIGNING_KEY_ID,
    repoRoot,
  });
  assertWriterSnapshot(signed);
  const outputRoot = env.SNAPSHOT_OUTPUT_DIR || repoRoot;
  const date = String(signed.date);
  const result = writeSnapshotTree({ repoRoot, outputRoot, snapshot: signed as never });
  console.log(JSON.stringify({ ok: true, date, ...result }));
  return { date };
}

if (import.meta.main) runSign(process.env);

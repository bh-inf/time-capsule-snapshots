import { assertWriterSnapshot } from "@time-capsule/schema";
import { collectSnapshot, findMissingDates, readIndex, signSnapshot, writeSnapshotTree } from "@time-capsule/snapshot";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function signatureRequired(): boolean {
  return process.env.SNAPSHOT_REQUIRE_SIGNATURE !== "0";
}

async function runCollect(write: boolean): Promise<void> {
  const required = signatureRequired();
  const snapshot = await collectSnapshot({
    now: process.env.SNAPSHOT_NOW ? new Date(process.env.SNAPSHOT_NOW) : new Date(),
    cwaApiKey: process.env.CWA_API_KEY,
    kkbox: {
      clientId: process.env.KKBOX_CLIENT_ID ?? "",
      clientSecret: process.env.KKBOX_CLIENT_SECRET ?? "",
    },
    requireConfiguredSources: required,
    onWarning: (message) => console.log(`::warning::${message}`),
  });
  if (!write) {
    console.log(JSON.stringify({ ok: true, canary: true, date: snapshot.date, missing: snapshot.missing }));
    return;
  }
  const signed = signSnapshot(snapshot, {
    requireSignature: required,
    keyHex: process.env.SNAPSHOT_SIGNING_KEY_HEX,
    keyId: process.env.SNAPSHOT_SIGNING_KEY_ID,
    repoRoot,
  });
  assertWriterSnapshot(signed);
  const outputRoot = process.env.SNAPSHOT_OUTPUT_DIR || repoRoot;
  const result = writeSnapshotTree({ repoRoot, outputRoot, snapshot: signed });
  console.log(JSON.stringify({ ok: true, date: signed.date, ...result }));
}

function reportGaps(): void {
  const index = readIndex(repoRoot, "TW");
  if (index.dates.length === 0) {
    console.log(JSON.stringify({ gaps: [] }));
    return;
  }
  const gaps = findMissingDates(index.dates, index.dates[0]!, index.dates[index.dates.length - 1]!);
  console.log(JSON.stringify({ gaps }));
  if (gaps.length > 0) process.exitCode = 1;
}

const command = process.argv[2] ?? "collect";
if (command === "canary") {
  await runCollect(false);
} else if (command === "collect") {
  await runCollect(true);
} else if (command === "gaps") {
  reportGaps();
} else {
  console.error("usage: main.ts canary|collect|gaps");
  process.exit(1);
}

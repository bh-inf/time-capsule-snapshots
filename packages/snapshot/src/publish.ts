import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Snapshot } from "./normalize.ts";

export type ArchiveIndex = {
  schema_version: 1;
  region: string;
  dates: string[];
  latest: string | null;
};

const DATE_FILE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}\.json$/;

export function snapshotRelativePath(region: string, date: string): string {
  if (!/^[A-Z]{2}$/.test(region)) throw new Error("invalid region");
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) throw new Error("invalid date");
  return join("v1", region, date.slice(0, 4), `${date}.json`);
}

function assertRegular(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`refusing to follow non-regular file ${path}`);
  }
}

export function readIndex(root: string, region: string): ArchiveIndex {
  const path = join(root, "v1", region, "index.json");
  try {
    assertRegular(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { schema_version: 1, region, dates: [], latest: null };
    }
    throw error;
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as ArchiveIndex;
  return {
    schema_version: 1,
    region,
    dates: Array.isArray(parsed.dates) ? parsed.dates : [],
    latest: parsed.latest ?? null,
  };
}

export function mergeIndex(existing: ArchiveIndex, date: string): ArchiveIndex {
  const dates = [...new Set([...existing.dates, date])].sort();
  return {
    schema_version: 1,
    region: existing.region,
    dates,
    latest: dates[dates.length - 1] ?? null,
  };
}

export type WriteResult = {
  datePath: string;
  wroteDate: boolean;
  indexPath: string;
};

export function writeSnapshotTree(options: {
  repoRoot: string;
  outputRoot?: string;
  snapshot: Snapshot;
}): WriteResult {
  const outputRoot = options.outputRoot ?? options.repoRoot;
  const relative = snapshotRelativePath(options.snapshot.region, options.snapshot.date);
  const datePath = join(outputRoot, relative);
  const sourceDate = join(options.repoRoot, relative);
  const body = `${JSON.stringify(options.snapshot, null, 2)}\n`;
  let wroteDate = false;
  mkdirSync(dirname(datePath), { recursive: true });
  if (exists(sourceDate)) {
    assertRegular(sourceDate);
    if (outputRoot !== options.repoRoot && !exists(datePath)) {
      writeFileSync(datePath, readFileSync(sourceDate), { flag: "wx" });
    }
  } else if (exists(datePath)) {
    assertRegular(datePath);
    if (readFileSync(datePath, "utf8") !== body) {
      throw new Error(`refusing to modify archived date file ${relative}`);
    }
  } else {
    writeFileSync(datePath, body, { flag: "wx" });
    wroteDate = true;
  }
  const index = mergeIndex(readIndex(options.repoRoot, options.snapshot.region), options.snapshot.date);
  const indexPath = join(outputRoot, "v1", options.snapshot.region, "index.json");
  mkdirSync(dirname(indexPath), { recursive: true });
  if (exists(indexPath)) assertRegular(indexPath);
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  return { datePath: relative, wroteDate, indexPath: join("v1", options.snapshot.region, "index.json") };
}

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export function isDateArchivePath(path: string): boolean {
  const parts = path.split("/");
  return parts.length === 4 && parts[0] === "v1" && /^[A-Z]{2}$/.test(parts[1]!) && /^[0-9]{4}$/.test(parts[2]!) && DATE_FILE.test(parts[3]!);
}

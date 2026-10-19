#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = new Set([
  "MIT",
  "MIT-0",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "Unlicense",
  "CC0-1.0",
  "Python-2.0",
  "BlueOak-1.0.0",
]);

function licensesOf(value) {
  if (!value) return [];
  if (typeof value === "string") {
    return value
      .replace(/[()]/g, " ")
      .split(/\s+(?:OR|AND)\s+|\s+/)
      .map((part) => part.trim())
      .filter((part) => part && part !== "OR" && part !== "AND");
  }
  if (typeof value === "object" && typeof value.type === "string") return licensesOf(value.type);
  if (Array.isArray(value)) return value.flatMap((item) => licensesOf(item));
  return [];
}

const store = "node_modules/.pnpm";
const failures = [];
let checked = 0;
for (const entry of readdirSync(store)) {
  const modules = join(store, entry, "node_modules");
  let names;
  try {
    names = readdirSync(modules);
  } catch {
    continue;
  }
  for (const name of names) {
    const pkgDir = name.startsWith("@") ? join(modules, name) : modules;
    const pkgNames = name.startsWith("@") ? readdirSync(pkgDir) : [name];
    const scope = name.startsWith("@") ? name : "";
    for (const pkgName of pkgNames) {
      const dir = scope ? join(pkgDir, pkgName) : join(modules, pkgName);
      const file = join(dir, "package.json");
      try {
        if (!statSync(file).isFile()) continue;
      } catch {
        continue;
      }
      const pkg = JSON.parse(readFileSync(file, "utf8"));
      checked += 1;
      const licenses = licensesOf(pkg.license ?? pkg.licenses);
      if (licenses.length === 0 || licenses.some((license) => !ALLOWED.has(license))) {
        failures.push(`${pkg.name}@${pkg.version}: ${JSON.stringify(pkg.license ?? pkg.licenses ?? null)}`);
      }
    }
  }
}

if (checked === 0) {
  console.error("no installed packages to license-check");
  process.exit(1);
}
if (failures.length > 0) {
  console.error("license check failed:");
  for (const failure of failures) console.error(failure);
  process.exit(1);
}
console.log(`ok (${checked} packages)`);

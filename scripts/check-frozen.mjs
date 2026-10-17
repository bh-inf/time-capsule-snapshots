#!/usr/bin/env node
import { execSync } from "node:child_process";

const base = process.argv[2] ?? "origin/main";
let diff = "";
try {
  diff = execSync(`git diff --name-status --diff-filter=MDR ${base}...HEAD`, {
    encoding: "utf8",
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const frozen = [
  /^v1\/[A-Z]{2}\/[0-9]{4}\/[0-9]{4}-[0-9]{2}-[0-9]{2}\.json$/,
  /^v1\/schema\/snapshot-v1\.\d+\.json$/,
  /^v1\/TW\/registry\/price-items\.v\d+\.json$/,
];

const violations = diff
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((line) => {
    const path = line.split("\t").pop() ?? "";
    return frozen.some((pattern) => pattern.test(path));
  });

if (violations.length > 0) {
  console.error("frozen archive paths were modified, deleted, or renamed:");
  for (const line of violations) console.error(line);
  process.exit(1);
}

console.log("frozen archive paths unchanged");

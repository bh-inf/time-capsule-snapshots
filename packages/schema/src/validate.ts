import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";

const schemaDir = join(dirname(fileURLToPath(import.meta.url)), "..", "schema");

export const SCHEMA_URL =
  "https://bh-inf.github.io/time-capsule-snapshots/v1/schema/snapshot-v1.1.json";

const ajv = new Ajv({
  allErrors: true,
  strict: true,
  allowUnionTypes: true,
});

function loadSchema(name: string): ValidateFunction {
  const schema = JSON.parse(readFileSync(join(schemaDir, name), "utf8")) as object;
  return ajv.compile(schema);
}

const validateWriter = loadSchema("snapshot-v1.1.json");
const validateReaderV10 = loadSchema("snapshot-v1.0.json");

export function schemaErrors(validate: ValidateFunction): string {
  return (validate.errors ?? [])
    .map((err: ErrorObject) => `${err.instancePath || "/"} ${err.message ?? ""}`.trim())
    .join("; ");
}

export function assertWriterSnapshot(value: unknown): void {
  if (!validateWriter(value)) {
    throw new Error(`snapshot schema rejected the document: ${schemaErrors(validateWriter)}`);
  }
}

export function writerAccepts(value: unknown): boolean {
  return Boolean(validateWriter(value));
}

/** Frozen minor-0 reader. Used to prove an old reader accepts newer optional fields. */
export function readerV10Accepts(value: unknown): boolean {
  return Boolean(validateReaderV10(value));
}

export function readSchemaText(name: "snapshot-v1.0.json" | "snapshot-v1.1.json"): string {
  return readFileSync(join(schemaDir, name), "utf8");
}

export function trendsUrlPattern(): string {
  const schema = JSON.parse(readSchemaText("snapshot-v1.1.json")) as {
    definitions: { trend: { properties: { url: { pattern: string } } } };
  };
  return schema.definitions.trend.properties.url.pattern;
}

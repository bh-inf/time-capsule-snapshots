import canonicalize from "canonicalize";

/** Network bodies are capped separately. This guard is for JSON text we intentionally parse. */
export const MAX_JSON_BYTES = 4_000_000;

export function canonicalJson(value: unknown): string {
  const text = canonicalize(value);
  if (typeof text !== "string") {
    throw new Error("canonicalize returned an empty value");
  }
  return text;
}

export function assertJsonByteLimit(text: string, limit = MAX_JSON_BYTES): void {
  if (Buffer.byteLength(text, "utf8") > limit) {
    throw new Error(`json exceeds ${limit} bytes`);
  }
}

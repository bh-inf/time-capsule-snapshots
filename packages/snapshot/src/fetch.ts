import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";
import { assertPublicAddresses } from "./address.ts";
import { assertPublicHttpsUrl, sameOrigin } from "./url-policy.ts";

export const USER_AGENT =
  "time-capsule-snapshots/1.0 (+https://github.com/bh-inf/time-capsule-snapshots)";

export const MAX_RESPONSE_BYTES = 2_000_000;
export const MAX_REDIRECTS = 2;
export const REQUEST_TIMEOUT_MS = 20_000;

export type LookupFn = (
  hostname: string,
  callback: (err: NodeJS.ErrnoException | null, addresses?: LookupAddress[]) => void,
) => void;

export function createPublicLookup(resolve: LookupFn) {
  return function publicLookup(
    hostname: string,
    options: unknown,
    callback?: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
  ): void {
    const opts = typeof options === "function" ? {} : (options as { all?: boolean });
    const done = typeof options === "function" ? options : callback;
    if (!done) return;
    resolve(hostname, (err, addresses) => {
      if (err || !addresses) {
        done(err ?? Object.assign(new Error("dns lookup failed"), { code: "ENOTFOUND" }));
        return;
      }
      try {
        assertPublicAddresses(addresses.map((entry) => entry.address));
      } catch {
        const refusal = Object.assign(new Error("refusing non-public address"), {
          code: "ENOTFOUND",
        });
        done(refusal);
        return;
      }
      const chosen = addresses[0]!;
      if (opts.all) {
        done(null, [{ address: chosen.address, family: chosen.family }]);
        return;
      }
      done(null, chosen.address, chosen.family);
    });
  };
}

export const publicLookup = createPublicLookup((hostname, callback) => {
  dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) {
      callback(err);
      return;
    }
    callback(null, addresses);
  });
});

let sharedAgent: Agent | undefined;

export function snapshotDispatcher(): Dispatcher {
  if (!sharedAgent) {
    sharedAgent = new Agent({
      connect: {
        lookup: publicLookup,
        timeout: REQUEST_TIMEOUT_MS,
      },
    });
  }
  return sharedAgent;
}

export class HttpBytes {
  constructor(
    readonly status: number,
    readonly headers: { get(name: string): string | null },
    readonly body: Uint8Array,
  ) {}

  text(): string {
    return new TextDecoder("utf-8", { fatal: false }).decode(this.body);
  }
}

export type OneShot = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<HttpBytes>;

export function redactUrl(input: string): string {
  try {
    const url = new URL(input);
    if (url.searchParams.has("Authorization")) url.searchParams.set("Authorization", "REDACTED");
    if (url.searchParams.has("authorization")) url.searchParams.set("authorization", "REDACTED");
    if (url.username) url.username = "REDACTED";
    if (url.password) url.password = "REDACTED";
    return url.toString();
  } catch {
    return "[redacted-url]";
  }
}

export function scrubSecrets(message: string, secrets: readonly string[]): string {
  let text = message;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) text = text.split(secret).join("[redacted]");
  }
  return text.replace(/\b[0-9a-fA-F]{32,}\b/g, "[redacted]");
}

async function readBody(response: { body: ReadableStream<Uint8Array> | null }, maxBytes: number, allowPrefix: boolean): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.byteLength > maxBytes) {
        if (!allowPrefix) {
          await reader.cancel();
          throw new Error("response exceeds size limit");
        }
        const room = maxBytes - total;
        if (room > 0) chunks.push(value.subarray(0, room));
        total = maxBytes;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export function undiciOneShot(maxBytes: number, allowPrefix: boolean): OneShot {
  return async (url, init) => {
    const response = await undiciFetch(url, {
      method: "GET",
      redirect: "manual",
      headers: init.headers,
      signal: init.signal,
      dispatcher: snapshotDispatcher(),
    });
    const lengthHeader = response.headers.get("content-length");
    if (!allowPrefix && lengthHeader) {
      const declared = Number(lengthHeader);
      if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel();
        throw new Error("response exceeds size limit");
      }
    }
    const body = await readBody(response, maxBytes, allowPrefix);
    return new HttpBytes(response.status, response.headers, body);
  };
}

function locationOf(current: URL, headers: { get(name: string): string | null }): URL {
  const location = headers.get("location");
  if (!location) throw new Error("redirect missing location");
  return new URL(location, current);
}

export async function safeFetch(
  input: string,
  options?: {
    headers?: Record<string, string>;
    maxBytes?: number;
    allowPrefix?: boolean;
    oneShot?: OneShot;
    secrets?: readonly string[];
  },
): Promise<HttpBytes> {
  const maxBytes = options?.maxBytes ?? MAX_RESPONSE_BYTES;
  const allowPrefix = options?.allowPrefix ?? false;
  const oneShot = options?.oneShot ?? undiciOneShot(maxBytes, allowPrefix);
  const headers = {
    "user-agent": USER_AGENT,
    accept: "application/json, application/rss+xml, application/xml, text/xml, */*",
    ...options?.headers,
  };
  let current = assertPublicHttpsUrl(input);
  const started = current;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response: HttpBytes;
    try {
      response = await oneShot(current.toString(), { headers, signal });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(scrubSecrets(`${message} (${redactUrl(current.toString())})`, options?.secrets ?? []));
    }
    if (response.status >= 300 && response.status < 400) {
      if (hop === MAX_REDIRECTS) throw new Error("too many redirects");
      const next = locationOf(current, response.headers);
      assertPublicHttpsUrl(next.toString());
      if (!sameOrigin(started, next)) throw new Error("redirect changed host or port");
      current = next;
      continue;
    }
    return response;
  }
  throw new Error("too many redirects");
}

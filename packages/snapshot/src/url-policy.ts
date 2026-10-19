import { isIP } from "node:net";

const THREADS_HOSTS = ["threads.com", "threads.net"];

export function httpsPort(url: URL): string {
  return url.port || "443";
}

function normalizedHost(hostname: string): string {
  return hostname.replace(/\.+$/, "").toLowerCase();
}

export function isThreadsHost(hostname: string): boolean {
  const host = normalizedHost(hostname);
  return THREADS_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

function isBlockedSuffix(hostname: string): boolean {
  const host = normalizedHost(hostname);
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  return false;
}

/**
 * Syntax check only. DNS pinning happens at connect time so names like
 * 127.0.0.1.nip.io are rejected from the address they actually resolve to.
 */
export function assertPublicHttpsUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("refusing unparsable url");
  }
  if (url.protocol !== "https:") throw new Error("refusing non-https url");
  if (url.username || url.password) throw new Error("refusing url with userinfo");
  const host = normalizedHost(url.hostname);
  if (!host) throw new Error("refusing empty host");
  if (isIP(host) || /^\d+$/.test(host)) throw new Error("refusing ip literal");
  if (isBlockedSuffix(host)) throw new Error("refusing local host");
  if (isThreadsHost(host)) throw new Error("refusing threads host");
  return url;
}

export function sameOrigin(left: URL, right: URL): boolean {
  return (
    normalizedHost(left.hostname) === normalizedHost(right.hostname) &&
    httpsPort(left) === httpsPort(right)
  );
}

export function scrubSecrets(message: string, secrets: readonly string[]): string {
  let text = message;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) text = text.split(secret).join("[redacted]");
  }
  return text.replace(/\b[0-9a-fA-F]{32,}\b/g, "[redacted]");
}

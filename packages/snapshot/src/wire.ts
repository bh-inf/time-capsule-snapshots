const WIRE_PATTERNS: readonly RegExp[] = [
  /\bAssociated Press\b/i,
  /\bReuters\b/i,
  /\bAgence France[- ]Presse\b/i,
  /(^|[^A-Za-z])AFP([^A-Za-z]|$)/,
  /(^|[^A-Za-z])AP([^A-Za-z]|$)/,
  /美聯社|美联社/,
  /路透/,
  /法新社|法新/,
];

export function isWireService(...fields: string[]): boolean {
  const haystack = fields.filter(Boolean).join("\n");
  return WIRE_PATTERNS.some((pattern) => pattern.test(haystack));
}

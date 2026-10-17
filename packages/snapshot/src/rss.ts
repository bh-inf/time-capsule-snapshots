const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** One left-to-right pass. `&amp;lt;` stays `&lt;` because the first entity is consumed. */
export function decodeXmlEntities(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i += 1) {
    if (input.charCodeAt(i) !== 38) {
      out += input[i];
      continue;
    }
    const semi = input.indexOf(";", i + 1);
    if (semi < 0 || semi - i > 16) {
      out += "&";
      continue;
    }
    const token = input.slice(i + 1, semi);
    if (Object.prototype.hasOwnProperty.call(NAMED, token)) {
      out += NAMED[token]!;
      i = semi;
      continue;
    }
    let codePoint: number | null = null;
    if (token.startsWith("#x") || token.startsWith("#X")) {
      const digits = token.slice(2);
      if (/^[0-9a-fA-F]+$/.test(digits)) codePoint = Number.parseInt(digits, 16);
    } else if (token.startsWith("#")) {
      const digits = token.slice(1);
      if (/^[0-9]+$/.test(digits)) codePoint = Number.parseInt(digits, 10);
    }
    if (codePoint === null || codePoint < 0 || codePoint > 0x10ffff) {
      out += "&";
      continue;
    }
    out += String.fromCodePoint(codePoint);
    i = semi;
  }
  return out;
}

export function cleanText(input: string): string {
  return input.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
}

function isTagBoundary(char: string | undefined): boolean {
  return char === ">" || char === " " || char === "/" || char === "\n" || char === "\r" || char === "\t";
}

/** Linear scan. An unclosed tag stops the scan instead of backtracking. */
export function extractElements(xml: string, tag: string, limit: number): string[] {
  const lower = xml.toLowerCase();
  const open = `<${tag.toLowerCase()}`;
  const close = `</${tag.toLowerCase()}>`;
  const found: string[] = [];
  let cursor = 0;
  while (found.length < limit) {
    const start = lower.indexOf(open, cursor);
    if (start < 0) break;
    if (!isTagBoundary(lower[start + open.length])) {
      cursor = start + open.length;
      continue;
    }
    const gt = lower.indexOf(">", start);
    if (gt < 0) break;
    if (lower[gt - 1] === "/") {
      cursor = gt + 1;
      continue;
    }
    const end = lower.indexOf(close, gt + 1);
    if (end < 0) break;
    found.push(xml.slice(gt + 1, end));
    cursor = end + close.length;
  }
  return found;
}

function innerText(fragment: string, tag: string): string {
  const blocks = extractElements(fragment, tag, 1);
  if (blocks.length === 0) return "";
  const raw = blocks[0]!;
  const lower = raw.toLowerCase();
  const cdata = "<![cdata[";
  const at = lower.indexOf(cdata);
  if (at >= 0) {
    const end = lower.indexOf("]]>", at + cdata.length);
    if (end >= 0) return cleanText(raw.slice(at + cdata.length, end));
  }
  return cleanText(decodeXmlEntities(raw));
}

export type RssItem = {
  title: string;
  link: string;
  author: string;
  source: string;
};

export function parseRssItems(xml: string, limit = 20): RssItem[] {
  return extractElements(xml, "item", limit).map((item) => ({
    title: innerText(item, "title"),
    link: innerText(item, "link"),
    author: innerText(item, "author"),
    source: innerText(item, "source"),
  }));
}

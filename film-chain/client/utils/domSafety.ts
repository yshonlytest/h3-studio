export interface SanitizeUrlOptions {
  allowDataImage?: boolean;
  allowBlob?: boolean;
  allowRelative?: boolean;
}

const ALLOWED_TOOLTIP_TAGS = new Set([
  "strong",
  "b",
  "em",
  "i",
  "br",
  "code",
  "span",
  "div",
  "p",
  "ul",
  "ol",
  "li",
  "a",
  "small",
  "hr",
]);

export function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function sanitizeUrl(raw: unknown, options: SanitizeUrlOptions = {}): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";

  // Reject ASCII control chars (including tabs/newlines inside obfuscated schemes) and HTML attribute/tag delimiters.
  if (/[\u0000-\u001F\u007F"'<>`]/.test(trimmed)) {
    return "";
  }
  if (trimmed.startsWith("//") || trimmed.startsWith("\\")) {
    return "";
  }

  const allowBlob = options.allowBlob !== false;
  const allowRelative = options.allowRelative !== false;
  const allowDataImage = options.allowDataImage === true;

  if (/^[a-zA-Z][a-zA-Z0-9+.\s-]*:/.test(trimmed)) {
    if (/^https?:\/\/[^\s]+$/i.test(trimmed)) {
      return trimmed;
    }
    if (allowBlob && /^blob:[^\s]+$/i.test(trimmed)) {
      return trimmed;
    }
    if (allowDataImage) {
      const compactData = trimmed.replace(/\s+/g, "");
      if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(compactData)) {
        return compactData;
      }
    }
    return "";
  }

  return allowRelative ? trimmed : "";
}

function sanitizeSafeAttributes(tagName: string, rawAttrs: string): string {
  if (!rawAttrs || tagName === "br" || tagName === "hr") return "";
  const safeParts: string[] = [];
  const attrRegex = /([a-zA-Z][a-zA-Z0-9-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

  for (const match of rawAttrs.matchAll(attrRegex)) {
    const name = match[1].toLowerCase();
    const rawVal = match[2] ?? match[3] ?? match[4] ?? "";
    if (name.startsWith("on")) continue;

    if (name === "class" || name === "title") {
      safeParts.push(`${name}="${escapeHtml(rawVal)}"`);
    } else if (name === "href" && tagName === "a") {
      const safeHref = sanitizeUrl(rawVal, { allowDataImage: false, allowBlob: false, allowRelative: true });
      if (safeHref) {
        safeParts.push(`href="${escapeHtml(safeHref)}"`);
      }
    } else if (name === "style") {
      const lowerStyle = rawVal.toLowerCase();
      if (!lowerStyle.includes("expression(") && !lowerStyle.includes("javascript:") && !lowerStyle.includes("url(")) {
        safeParts.push(`style="${escapeHtml(rawVal)}"`);
      }
    }
  }

  return safeParts.length > 0 ? ` ${safeParts.join(" ")}` : "";
}

export function sanitizeTrustedTooltipHtml(rawHtml: string): string {
  if (!rawHtml || typeof rawHtml !== "string") return "";

  let cleaned = rawHtml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|svg|math|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");

  cleaned = cleaned.replace(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g, (_full, slash: string, tag: string, attrs: string) => {
    const lowerTag = tag.toLowerCase();
    if (!ALLOWED_TOOLTIP_TAGS.has(lowerTag)) {
      return "";
    }
    if (slash) {
      return lowerTag === "br" || lowerTag === "hr" ? "" : `</${lowerTag}>`;
    }
    const safeAttrs = sanitizeSafeAttributes(lowerTag, attrs);
    return `<${lowerTag}${safeAttrs}>`;
  });

  return cleaned.trim();
}

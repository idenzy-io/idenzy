const ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/**
 * Derives a plain-text body from an HTML one.
 *
 * The fallback for a customer template that has no text part, not what the built-in
 * templates use: those author both, because the text part of a transactional mail is
 * what a screen reader and a spam filter read, and a mechanical strip reads like one.
 *
 * Anchor text keeps its href alongside it, since a link the reader cannot see is the
 * one thing a text part must not lose.
 */
export function toPlainText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|h[1-6]|li)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

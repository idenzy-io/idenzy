/**
 * The tidy behind the beautify glyph on the HTML body: indentation and line breaks put
 * back into markup that arrived as one line.
 *
 * Written here rather than pulled in, and the reason is the corpus. Email markup is a
 * narrow, old dialect: tables, inline styles three hundred characters long, and
 * conditional comments addressed to a mail client that shipped in 2007. A general
 * formatter is a parser with opinions about a document, and the opinions that matter here
 * are that it must not touch a byte a mail client reads. So this one rewrites exactly two
 * things, whitespace between tags and whitespace between attributes, both of which are
 * insignificant in HTML by specification, and copies everything else through untouched.
 *
 * What it deliberately does not do: it does not close an unclosed tag, reorder an
 * attribute, requote a value, lowercase a name, or decide that an empty element is
 * unnecessary. A formatter that repairs is a formatter that can break a body which was
 * rendering, and the reader pressed a button labelled tidy.
 *
 * Three things are copied verbatim rather than formatted, because in each the whitespace
 * is content: the inside of `<pre>` and `<textarea>`, the inside of `<script>` and
 * `<style>`, and the inside of any comment. A conditional comment is a comment, which is
 * how `<!--[if mso]>` survives.
 *
 * It is idempotent, and there is a test that says so: a reader who presses the glyph
 * twice must not watch the body drift.
 */

/** Elements with no closing tag, so nothing indents under them. */
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * Elements that sit in a line of text rather than starting one.
 *
 * A body full of `<a>` and `<strong>` broken onto their own lines is less readable than
 * the single line it started as, and the sentence a customer is editing stops being a
 * sentence. `img` and `br` are here for the same reason: in email copy they sit inside a
 * paragraph far more often than they stand alone.
 */
const INLINE_ELEMENTS = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "big",
  "br",
  "button",
  "cite",
  "code",
  "data",
  "dfn",
  "em",
  "font",
  "i",
  "img",
  "input",
  "kbd",
  "label",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strike",
  "strong",
  "sub",
  "sup",
  "time",
  "tt",
  "u",
  "var",
  "wbr",
]);

/** Elements whose content is text and not markup, copied through exactly as written. */
const RAW_ELEMENTS = new Set(["script", "style", "pre", "textarea"]);

const INDENT = "  ";

/** Past this, an open tag with more than one attribute is broken over several lines. */
const TAG_WIDTH = 100;

/** Where an inline run is broken, when it can be broken at all. */
const LINE_WIDTH = 96;

interface Token {
  kind: "open" | "close" | "void" | "text" | "raw" | "verbatim";
  /** Lowercased element name, for the tokens that have one. */
  name: string;
  text: string;
}

/*
 * A comment, a doctype or a CDATA section: everything between the markers is content and
 * is copied through. The comment pattern is deliberately the lazy one, so a downlevel
 * conditional comment ends at its own `-->` rather than swallowing the body after it.
 */
const VERBATIM = /^<!(?:--[\s\S]*?--)?[^>]*>/;
const TAG = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/;

/**
 * Markup as a flat list of tokens.
 *
 * Flat rather than a tree, because a tree needs a well-formedness decision and this
 * function has none to make: a stray `</div>` is somebody's markup and is written back
 * out as it was found. Depth is counted while printing instead, and it never goes below
 * zero.
 */
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;

  while (at < source.length) {
    const next = source.indexOf("<", at);

    if (next === -1) {
      tokens.push({ kind: "text", name: "", text: source.slice(at) });
      break;
    }

    if (next > at) tokens.push({ kind: "text", name: "", text: source.slice(at, next) });

    const token = tagAt(source, next);
    tokens.push(token);
    at = next + token.text.length;
  }

  return tokens;
}

/** The one token starting at a `<`, which for a raw element is the whole element. */
function tagAt(source: string, at: number): Token {
  const rest = source.slice(at);

  const verbatim = VERBATIM.exec(rest);
  if (verbatim !== null) return { kind: "verbatim", name: "", text: verbatim[0] };

  const tag = TAG.exec(rest);
  /* A lone `<` in the text. Copied through as the character it is. */
  if (tag === null) return { kind: "text", name: "", text: "<" };

  const [whole, slash, rawName = "", , selfClosing] = tag;
  const name = rawName.toLowerCase();

  if (slash === "/") return { kind: "close", name, text: whole };

  if (RAW_ELEMENTS.has(name) && selfClosing !== "/") {
    const remainder = source.slice(at + whole.length);
    const end = new RegExp(`</${name}\\s*>`, "i").exec(remainder);
    const body = end === null ? remainder : remainder.slice(0, end.index) + end[0];
    return { kind: "raw", name, text: whole + body };
  }

  const kind = selfClosing === "/" || VOID_ELEMENTS.has(name) ? "void" : "open";
  return { kind, name, text: whole };
}

/** The attribute region of an open tag, split where the tag is long enough to warrant it. */
const ATTRIBUTE = /[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?/g;

/**
 * A long open tag broken one attribute to a line, indented ready to print.
 *
 * Whitespace between attributes is insignificant, so this is a safe rewrite; it is
 * applied only where it buys something, which is a tag past the width with more than one
 * attribute. Email markup is where it earns its place: a `<td>` carrying four attributes
 * and a three-hundred-character `style` is unreadable as one line and obvious as five.
 *
 * The split is abandoned rather than approximated unless the attributes account for the
 * whole region with nothing but whitespace between them. Anything else means something
 * unusual is in there, and printing it back exactly as it arrived is always right.
 */
function splitAttributes(tag: string, indent: string): string {
  if (tag.length + indent.length <= TAG_WIDTH) return indent + tag;

  const parsed = TAG.exec(tag);
  if (parsed === null) return indent + tag;
  const [, , name = "", region = "", selfClosing = ""] = parsed;

  const attributes: string[] = [];
  let at = 0;
  ATTRIBUTE.lastIndex = 0;
  for (const match of region.matchAll(ATTRIBUTE)) {
    /* Only whitespace may sit between one attribute and the next. */
    if (region.slice(at, match.index).trim() !== "") return indent + tag;
    attributes.push(match[0]);
    at = match.index + match[0].length;
  }
  if (attributes.length < 2 || region.slice(at).trim() !== "") return indent + tag;

  const inner = indent + INDENT;
  return [
    `${indent}<${name}`,
    ...attributes.map((attribute) => inner + attribute),
    `${indent}${selfClosing === "/" ? "/>" : ">"}`,
  ].join("\n");
}

/**
 * One piece of an inline run, and whether whitespace already sits in front of it.
 *
 * `space` is the whole reason this is a record rather than a string. A line may only be
 * broken where whitespace already is, because there a newline replaces it and HTML
 * collapses the two to the same thing. Break anywhere else and the markup gains a space
 * it did not have: between `<a href=...>` and the word after it, that space is inside the
 * link and the reader sees the underline start early.
 */
interface Piece {
  text: string;
  space: boolean;
}

/**
 * An inline run as pieces, split at every whitespace joint and nowhere else.
 *
 * Text is collapsed on the way in, which is the one rewrite HTML permits: a run of
 * spaces, tabs and newlines in flow content renders as a single space, so writing it as
 * one is the same document.
 */
function piecesOf(tokens: readonly Token[]): Piece[] {
  const pieces: Piece[] = [];
  let space = false;

  for (const token of tokens) {
    if (token.kind !== "text") {
      pieces.push({ text: token.text, space });
      space = false;
      continue;
    }

    const collapsed = token.text.replace(/\s+/g, " ");
    if (collapsed === "") continue;
    if (collapsed.startsWith(" ")) space = true;
    const body = collapsed.trim();
    if (body !== "") {
      for (const [at, word] of body.split(" ").entries()) {
        pieces.push({ text: word, space: space || at > 0 });
        space = false;
      }
    }
    if (collapsed.endsWith(" ")) space = true;
  }

  return pieces;
}

/** The run as a single string, which is what a short element is printed as. */
function joined(pieces: readonly Piece[]): string {
  return pieces
    .map((piece, at) => (piece.space && at > 0 ? ` ${piece.text}` : piece.text))
    .join("");
}

/**
 * The run filled to the line width, broken only at the joints that were already spaces.
 *
 * The width is counted from the last break rather than from the start of the line, and a
 * piece too long to fit on any line resets the count instead of consuming it. Without
 * that, one 160-character `<a>` tag puts the line over the width before its own text
 * begins, and the next joint after it becomes a break: an email's button reads "Sign" at
 * the end of one line and "in" at the start of the next. The tag is what is long, and
 * nothing can be done about the tag.
 */
function wrap(pieces: readonly Piece[], indent: string): string[] {
  const lines: string[] = [];
  const oversize = (piece: Piece) => indent.length + piece.text.length > LINE_WIDTH;
  let line = "";
  let width = 0;

  for (const piece of pieces) {
    const broken = line !== "" && piece.space && width + 1 + piece.text.length > LINE_WIDTH;
    if (broken) lines.push(indent + line);

    if (broken || line === "") {
      line = piece.text;
      width = oversize(piece) ? 0 : indent.length + piece.text.length;
      continue;
    }

    const separator = piece.space ? " " : "";
    line += separator + piece.text;
    width = oversize(piece) ? 0 : width + separator.length + piece.text.length;
  }

  if (line !== "") lines.push(indent + line);
  return lines;
}

/** Whether a token belongs in a line of text rather than starting one of its own. */
function isInline(token: Token): boolean {
  return token.kind === "text" || (token.kind !== "raw" && INLINE_ELEMENTS.has(token.name));
}

/**
 * The run of inline tokens an open tag encloses, where that is all it encloses.
 *
 * Null for anything else: an element holding another block, an element whose closing tag
 * is missing, an element holding a comment or a script. The caller uses it to keep a
 * short element on one line, and a wrong answer here would be a block silently flattened,
 * so the test is the strict one and everything unusual falls through to the general path.
 */
function simpleRun(tokens: readonly Token[], from: number): readonly Token[] | null {
  const opening = tokens[from];
  if (opening === undefined) return null;
  for (let at = from + 1; at < tokens.length; at += 1) {
    const token = tokens[at];
    if (token === undefined) return null;
    if (token.kind === "close" && token.name === opening.name) return tokens.slice(from + 1, at);
    if (!isInline(token)) return null;
  }
  return null;
}

/**
 * A whole element on one line, where it is short and holds nothing but a line of text.
 *
 * Null for anything else, and the caller then opens the tag and indents under it. This is
 * what the markup already said, and a paragraph of copy exploded over three lines is
 * harder to read than the sentence it was. `next` is the index of the element's closing
 * tag, which the caller resumes from.
 */
function oneLiner(
  tokens: readonly Token[],
  at: number,
  indent: string,
): { line: string; next: number } | null {
  const token = tokens[at];
  if (token === undefined) return null;
  if (splitAttributes(token.text, indent).includes("\n")) return null;

  const run = simpleRun(tokens, at);
  if (run === null) return null;

  const line = `${indent}${token.text}${joined(piecesOf(run))}</${token.name}>`;
  return line.length <= LINE_WIDTH ? { line, next: at + run.length + 1 } : null;
}

/**
 * A raw element or a comment, printed with its own bytes intact.
 *
 * A raw element's open tag may still be long enough to split; its body may not be touched
 * at all, so the two are printed separately. A comment keeps every byte including its own
 * line breaks: the first line is indented and the rest are left where the author put them.
 */
function printed(token: Token, indent: string): string {
  if (token.kind !== "raw") return indent + token.text;
  const opening = TAG.exec(token.text);
  if (opening === null) return indent + token.text;
  return splitAttributes(opening[0], indent) + token.text.slice(opening[0].length);
}

/**
 * Markup with the line breaks and indentation a reader can follow.
 *
 * Only whitespace between tags and between attributes is rewritten. Text, attribute
 * values, comments and raw element bodies come out byte for byte as they went in, so
 * `{{ otp }}` in a body and `{{ otp }}` in a subject are the same string afterwards and
 * the template validator sees no change it did not already see.
 */
export function formatHtml(source: string): string {
  const tokens = tokenize(source);
  const lines: string[] = [];
  let depth = 0;
  let pending: Token[] = [];

  const indent = () => INDENT.repeat(depth);

  function flush() {
    if (pending.length === 0) return;
    const pieces = piecesOf(pending);
    pending = [];
    if (pieces.length > 0) lines.push(...wrap(pieces, indent()));
  }

  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at];
    if (token === undefined) continue;

    if (isInline(token)) {
      pending.push(token);
      continue;
    }

    flush();

    if (token.kind === "close") {
      depth = Math.max(0, depth - 1);
      lines.push(indent() + token.text);
      continue;
    }

    if (token.kind === "open") {
      const single = oneLiner(tokens, at, indent());
      if (single !== null) {
        lines.push(single.line);
        at = single.next;
        continue;
      }
      lines.push(splitAttributes(token.text, indent()));
      depth += 1;
      continue;
    }

    if (token.kind === "void") {
      lines.push(splitAttributes(token.text, indent()));
      continue;
    }

    lines.push(printed(token, indent()));
  }

  flush();
  return lines.join("\n").trim();
}

/**
 * Whether tidying would change anything, so the control can say it has nothing to do
 * rather than reporting a change that did not happen.
 */
export function needsFormatting(source: string): boolean {
  return source.trim() !== "" && formatHtml(source) !== source;
}

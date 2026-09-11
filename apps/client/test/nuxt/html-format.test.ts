import { describe, expect, it } from "vitest";
import { BUILT_IN, type TemplateBodies } from "../../app/utils/email-templates";
import { formatHtml, needsFormatting } from "../../app/utils/html-format";

/**
 * Every byte that is not whitespace, in order.
 *
 * The formatter's whole promise is that it rewrites whitespace and nothing else, so this
 * is the check that says so: no tag added, none dropped, no attribute reordered, no
 * character of copy lost. That whitespace which carries meaning survives too is a
 * separate question, and the spacing tests above are what answer it.
 */
function withoutWhitespace(html: string): string {
  return html.replace(/\s/g, "");
}

describe("formatHtml", () => {
  it("puts block elements on their own lines and indents what is inside them", () => {
    expect(formatHtml("<div><p>Hello</p></div>")).toBe("<div>\n  <p>Hello</p>\n</div>");
  });

  it("keeps inline elements in the line of text they belong to", () => {
    const source = '<p>Use the <a href="https://example.com">link</a> to sign in.</p>';
    expect(formatHtml(source)).toBe(source);
  });

  it("does not indent under a void element", () => {
    expect(formatHtml("<div><hr><p>After</p></div>")).toBe("<div>\n  <hr>\n  <p>After</p>\n</div>");
  });

  it("breaks a long open tag one attribute to a line", () => {
    const style =
      "margin:0;padding:24px;background:#f5f5f5;font-size:15px;line-height:24px;color:#18181b";
    const formatted = formatHtml(`<div class="card" style="${style}">x</div>`);
    expect(formatted).toBe(
      ["<div", '  class="card"', `  style="${style}"`, ">", "  x", "</div>"].join("\n"),
    );
  });

  it("leaves a long tag alone when it carries only one attribute", () => {
    const source = `<a href="https://example.com/${"x".repeat(120)}">Go</a>`;
    expect(formatHtml(source)).toBe(source);
  });

  it("copies a comment through, conditional ones included", () => {
    const source = "<div><!--[if mso]><i>spacer</i><![endif]--><p>Hi</p></div>";
    expect(formatHtml(source)).toContain("<!--[if mso]><i>spacer</i><![endif]-->");
  });

  it("does not touch the inside of a style, script or pre element", () => {
    const source = "<div><style>\n  .a  {  color : red }\n</style></div>";
    expect(formatHtml(source)).toContain("<style>\n  .a  {  color : red }\n</style>");
  });

  it("leaves a placeholder exactly as written, spacing included", () => {
    expect(formatHtml("<p>{{ otp }} and {{project.name}}</p>")).toContain(
      "{{ otp }} and {{project.name}}",
    );
  });

  it("does not close an unclosed tag or invent one", () => {
    /* Unclosed, so the content is not a run this can keep on one line, and it indents
       under the tag rather than gaining a `</p>` nobody wrote. */
    expect(formatHtml("<div><p>Open")).toBe("<div>\n  <p>\n    Open");
    expect(formatHtml("</div>")).toBe("</div>");
  });

  it("keeps the space between a word and the inline element after it", () => {
    expect(formatHtml("<p>sign in to <b>Acme</b> now</p>")).toBe(
      "<p>sign in to <b>Acme</b> now</p>",
    );
  });

  it("wraps a long run of text without splitting a tag across the break", () => {
    const source = `<p>${"word ".repeat(40).trim()}</p>`;
    for (const line of formatHtml(source).split("\n")) {
      expect(line.split("<").length).toBe(line.split(">").length);
    }
  });

  /*
   * The property that matters most on a control the reader can press twice. A formatter
   * that drifts turns an idle click into a diff, and the reader has no way to tell that
   * from a change they made.
   */
  it("is idempotent", () => {
    for (const bodies of Object.values(BUILT_IN) as TemplateBodies[]) {
      const once = formatHtml(bodies.html);
      expect(formatHtml(once)).toBe(once);
    }
  });

  it("changes nothing but whitespace, over every built-in body", () => {
    for (const bodies of Object.values(BUILT_IN) as TemplateBodies[]) {
      expect(withoutWhitespace(formatHtml(bodies.html))).toBe(withoutWhitespace(bodies.html));
    }
  });
});

describe("needsFormatting", () => {
  it("is false for markup already laid out, and for an empty body", () => {
    expect(needsFormatting("")).toBe(false);
    expect(needsFormatting(formatHtml(BUILT_IN.email_otp?.html ?? ""))).toBe(false);
  });

  it("is true for the built-in copy, which ships as one line", () => {
    expect(needsFormatting(BUILT_IN.email_otp?.html ?? "")).toBe(true);
  });
});

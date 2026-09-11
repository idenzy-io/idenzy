/**
 * The editor's colours, built from the same ten values Shiki's blocks are built from
 * (`app/shiki/theme.ts`).
 *
 * Two highlighters colour code in this panel and they read different things: Shiki
 * resolves TextMate scopes out of a grammar, CodeMirror resolves Lezer tags out of a
 * parse tree, so one theme object cannot serve both. What they can share is the palette
 * underneath, and sharing it is what stops the HTML of an email being one set of colours
 * in the editor and a different set in the code block on the next card.
 *
 * The mapping from tag to role is the same reading Atom's own themes make: a tag name is
 * a property, an attribute name is a type, a string is a string. Ten roles cover both
 * languages this editor sees, and a role that would need an eleventh is a value to add in
 * one place rather than two.
 *
 * **The editor paints no background of its own.** The card owns the surface, as it does
 * for a code block, so the theme sets colours and metrics and leaves the ground to the
 * component's own stylesheet. That is also why this file has no `dark: true` flag on the
 * dark theme: Vuetify's theme class is what switches, and CodeMirror's own `dark` flag
 * would only reach the parts we are not asking it to paint.
 */

import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { type CodePalette, DARK, LIGHT } from "~/shiki/theme";

/**
 * The palette applied to Lezer's tags.
 *
 * `tags.content` and `tags.name` are what an HTML document's text and unclassified names
 * come out as, and both take the default face: colour is spent on markup rather than on
 * the words a reader is writing, which in an email body is most of the file.
 */
function highlightFor(palette: CodePalette): HighlightStyle {
  return HighlightStyle.define([
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: palette.comment },
    { tag: [tags.content, tags.name], color: palette.ink },
    { tag: [tags.tagName, tags.standard(tags.tagName)], color: palette.property },
    { tag: [tags.attributeName], color: palette.type },
    { tag: [tags.attributeValue, tags.string, tags.special(tags.string)], color: palette.string },
    { tag: [tags.number, tags.bool, tags.null, tags.atom], color: palette.constant },
    { tag: [tags.keyword, tags.modifier], color: palette.keyword },
    { tag: [tags.function(tags.variableName), tags.propertyName], color: palette.callable },
    { tag: [tags.typeName, tags.className], color: palette.type },
    { tag: [tags.operator, tags.escape, tags.definitionOperator], color: palette.operator },
    { tag: [tags.angleBracket, tags.bracket, tags.punctuation], color: palette.ink },
    { tag: [tags.invalid], color: palette.invalid },
    { tag: [tags.link, tags.url], color: palette.callable, textDecoration: "underline" },
  ]);
}

/**
 * Metrics and the few chrome colours CodeMirror insists on painting itself.
 *
 * Everything addressable from a stylesheet is left to one (`CodeEditor.vue`'s own blocks),
 * because a rule there follows the theme through Vuetify's class the way the rest of the
 * panel does. What is here is the set CodeMirror writes inline or computes: the selection
 * layer, the cursor, the active line and the gutter.
 *
 * The completion and lint tooltips are deliberately not here. They are mounted outside the
 * editor so a card cannot clip them, and a theme's rules are prefixed with a class on the
 * editor's own root, so a rule written here would never reach them.
 */
function chromeFor(palette: CodePalette, faint: string): Extension {
  return EditorView.theme({
    "&": { color: palette.ink, backgroundColor: "transparent" },
    ".cm-content": { caretColor: palette.ink },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: palette.ink },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: faint,
    },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-gutters": { backgroundColor: "transparent", color: palette.comment, border: "none" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: palette.ink },
    ".cm-foldPlaceholder": {
      backgroundColor: faint,
      border: "none",
      color: palette.comment,
      padding: "0 4px",
    },
  });
}

/*
 * The selection wash, written out rather than read from the theme: CodeMirror puts these
 * into an inline stylesheet, where a `var()` naming Vuetify's own properties would resolve
 * against the document root and paint the light value inside a dark island.
 */
const LIGHT_FAINT = "rgba(24, 24, 27, 0.12)";
const DARK_FAINT = "rgba(245, 245, 245, 0.16)";

export const CODE_THEME_LIGHT: Extension = [
  chromeFor(LIGHT, LIGHT_FAINT),
  syntaxHighlighting(highlightFor(LIGHT)),
];

export const CODE_THEME_DARK: Extension = [
  chromeFor(DARK, DARK_FAINT),
  syntaxHighlighting(highlightFor(DARK)),
];

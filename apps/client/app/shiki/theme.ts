/**
 * The panel's syntax colours, as a pair of TextMate themes Shiki can load.
 *
 * These are Atom's One Dark and One Light, which is a deliberate exception to the rule
 * that this panel invents no palette of its own. Syntax colour is a thing developers
 * already read fluently: One Dark's green string and purple keyword are the same in
 * every editor they have open beside this tab, and a code block that agrees with the
 * editor is read faster than one that agrees with the sidebar. The panel's own hues stay
 * where they belong, on the chrome around the block.
 *
 * **The background is not theirs.** One Dark paints #282c34 and One Light #fafafa; both
 * are `transparent` here, because the card owns the surface and a code block that paints
 * its own is a hole cut in the page. Nothing else about a block is borrowed either: the
 * face, the size and the gutter are the panel's.
 *
 * **Two themes, because a canvas inherits nothing and neither does a token colour.**
 * Both are rendered into every block and theme.css picks between them off Vuetify's own
 * theme class, so a block follows the reader's choice without being re-highlighted.
 *
 * **Where the values differ from Atom's, contrast is why, and only where it had to.**
 * One Dark's own ground is #282c34 and ours is #20201f, so its comment grey lands under
 * 3:1 here and is lifted. One Light is the larger set of changes: four of its hues sit
 * between 3:1 and 4.5:1 on white, which passes as an editor's own choice and does not
 * pass as 11px text in a product a customer is asked to configure something in. Each one
 * is stepped down the same hue until it clears 4.5:1 and no further, so the palette still
 * reads as One Light. Every value below has been checked against the surface its theme
 * is drawn on.
 *
 * **The two palettes are exported as well as the two themes**, because the panel has a
 * second thing that colours code: the CodeMirror editor on the email template workspace
 * (`app/utils/code-theme.ts`). Shiki reads TextMate scopes and CodeMirror reads Lezer
 * tags, so the two cannot share a theme object; sharing the ten values underneath is what
 * stops a body being one set of colours while it is edited and another set the moment the
 * same markup appears in a code block beside it.
 */
import type { ThemeRegistrationRaw } from "shiki";

export interface CodePalette {
  /** The default face, and punctuation: anything the grammar gives no rule of its own. */
  ink: string;
  comment: string;
  /** An object key, a property, a tag, a plain variable. Atom's red. */
  property: string;
  string: string;
  /** Numbers, `true`, `false`, `null`, and a language's own named constants. */
  constant: string;
  keyword: string;
  /** A function or a method, at its definition and at its call. */
  callable: string;
  /** A type, a class, an attribute name. */
  type: string;
  /** Operators and escapes. */
  operator: string;
  invalid: string;
}

/* One Dark, verbatim but for the comment grey: Atom draws it on #282c34 and we are four
   steps darker than that, where its own value falls under 3:1. */
export const DARK: CodePalette = {
  ink: "#abb2bf",
  comment: "#848b98",
  property: "#e06c75",
  string: "#98c379",
  constant: "#d19a66",
  keyword: "#c678dd",
  callable: "#61afef",
  type: "#e5c07b",
  operator: "#56b6c2",
  invalid: "#be5046",
};

/* One Light, with the comment, the red, the green, the blue, the yellow and the cyan
   stepped down their own hues until each clears 4.5:1 on white. */
export const LIGHT: CodePalette = {
  ink: "#383a42",
  comment: "#6e7078",
  property: "#ca3b2f",
  string: "#3f8340",
  constant: "#986801",
  keyword: "#a626a4",
  callable: "#2d63dd",
  type: "#9a6a00",
  operator: "#0177a9",
  invalid: "#c62828",
};

/**
 * One palette, applied to the scopes a grammar emits. Written once and instantiated
 * twice: two hand-kept scope lists would drift, and the drift only shows in one theme.
 *
 * The roles are Atom's own and hold for every language, so JSON uses six of them and a
 * `.ts` block later uses all ten and both look like the reader's editor.
 */
function themeFor(name: string, type: "light" | "dark", p: CodePalette): ThemeRegistrationRaw {
  return {
    name,
    type,
    colors: { "editor.background": "transparent", "editor.foreground": p.ink },
    settings: [
      { settings: { background: "transparent", foreground: p.ink } },

      {
        scope: ["comment", "punctuation.definition.comment", "string.comment"],
        settings: { foreground: p.comment, fontStyle: "italic" },
      },

      /* Punctuation is the default face in One: a brace and a colon carry the shape and
         the colour is spent on the content. */
      {
        scope: [
          "punctuation",
          "meta.brace",
          "meta.delimiter",
          "punctuation.definition.string",
          "punctuation.separator",
          "punctuation.terminator",
        ],
        settings: { foreground: p.ink },
      },

      {
        scope: ["keyword.operator", "constant.other.color", "constant.character.escape"],
        settings: { foreground: p.operator },
      },

      /* An object key, a property and a bare variable share Atom's red. */
      {
        scope: [
          "support.type.property-name",
          "meta.object-literal.key",
          "variable",
          "variable.other",
          "variable.parameter",
          "entity.name.tag",
          "entity.name.tag.yaml",
        ],
        settings: { foreground: p.property },
      },

      {
        scope: [
          "string",
          "string.quoted",
          "string.template",
          "constant.other.symbol",
          "entity.other.inherited-class",
        ],
        settings: { foreground: p.string },
      },

      {
        scope: [
          "constant.numeric",
          "constant.language",
          "constant.character",
          "constant.other",
          "support.constant",
          "keyword.other.unit",
        ],
        settings: { foreground: p.constant },
      },

      {
        scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.control"],
        settings: { foreground: p.keyword },
      },

      {
        scope: ["entity.name.function", "support.function", "meta.function-call.generic"],
        settings: { foreground: p.callable },
      },

      {
        scope: [
          "entity.name.type",
          "entity.name.class",
          "support.class",
          "support.type",
          "entity.other.attribute-name",
        ],
        settings: { foreground: p.type },
      },

      { scope: ["invalid", "invalid.illegal"], settings: { foreground: p.invalid } },
    ],
  };
}

export const IDENZY_CODE_LIGHT = themeFor("idenzy-light", "light", LIGHT);
export const IDENZY_CODE_DARK = themeFor("idenzy-dark", "dark", DARK);

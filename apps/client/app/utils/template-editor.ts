/**
 * The template language, as CodeMirror extensions: what a placeholder looks like while it
 * is being typed, what completes it, and what is marked wrong.
 *
 * Kept out of `CodeEditor.vue` because it is the half that knows our grammar, and the
 * component is the half that knows the panel. It reads the same `scanPlaceholders` the
 * validator reads (`app/utils/email-templates.ts`), so a run marked red in the editor and
 * a field marked invalid under it are one reading of one rule rather than two that agree
 * most of the time.
 *
 * **Completion is offered in every field, and the subject is why.** A subject is a
 * one-line text input everywhere else in this panel, so it is the field most likely to be
 * typed by hand and the field where a mistyped `{{ user.mail }}` fails the send with no
 * markup to look at. The same list, the same colours and the same refusal apply to all
 * three bodies, because the grammar does.
 */

import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  startCompletion,
} from "@codemirror/autocomplete";
import { type Diagnostic, linter } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { scanPlaceholders, type TemplateVariable, VARIABLE_HELP } from "./email-templates";

/** What the editor is told about a message: everything its bodies may name. */
export interface TemplateScope {
  variables: readonly TemplateVariable[];
}

/*
 * Three marks, because there are three things a braced run can be and they fail
 * differently. A name in scope is substituted. A name out of scope throws and the mail is
 * never sent. Something that is not a placeholder at all is delivered to the reader
 * exactly as typed, which is the failure nobody notices until a customer forwards the
 * mail back.
 */
const KNOWN = Decoration.mark({ class: "cm-tpl cm-tpl--known" });
const UNKNOWN = Decoration.mark({ class: "cm-tpl cm-tpl--unknown" });
const MALFORMED = Decoration.mark({ class: "cm-tpl cm-tpl--malformed" });

function decorate(view: EditorView, scope: () => TemplateScope): DecorationSet {
  const known = new Set<string>(scope().variables);
  const marks = [];

  /* Visible ranges only: a body is small, but the same plugin runs on every keystroke and
     there is no reason to scan what nobody is looking at. */
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    for (const match of scanPlaceholders(text)) {
      const mark = match.name === null ? MALFORMED : known.has(match.name) ? KNOWN : UNKNOWN;
      marks.push(mark.range(from + match.from, from + match.to));
    }
  }

  return Decoration.set(marks);
}

/** The tint under `{{ … }}`, recomputed when the document, the viewport or the scope moves. */
export function placeholderMarks(scope: () => TemplateScope): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = decorate(view, scope);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.focusChanged) {
          this.decorations = decorate(update.view, scope);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

/*
 * What is being typed, when the cursor is inside a braced run.
 *
 * Matched backwards from the cursor rather than forwards from a token, because there is
 * no token: `{{ us` is not yet a placeholder and is exactly the moment the list is worth
 * showing. The pattern stops at a brace or a newline so an unclosed `{{` three lines up
 * does not make every word on the page look like a variable.
 */
const TYPING = /\{\{[ \t]*([a-zA-Z0-9_.]*)$/;

/** `}}`, and the spaces before it, so accepting a completion does not leave a second pair. */
const CLOSING = /^[ \t]*\}\}/;

function completionsFor(scope: TemplateScope): Completion[] {
  return scope.variables.map((name) => ({
    label: name,
    type: "variable",
    detail: VARIABLE_HELP[name]?.summary ?? "",
    info: VARIABLE_HELP[name]?.detail ?? "",
    /*
     * Applied by hand rather than as plain text, so what lands is the whole placeholder
     * with its spaces, and so a run that already had its closing braces does not end up
     * with two pairs. The reader typed `{{`; what they meant was `{{ name }}`.
     */
    apply: (view: EditorView, _option: Completion, from: number, to: number) => {
      const after = view.state.doc.sliceString(to, Math.min(to + 8, view.state.doc.length));
      const closing = CLOSING.exec(after);
      const end = to + (closing === null ? 0 : closing[0].length);
      const insert = `${name} }}`;
      view.dispatch({
        changes: { from, to: end, insert },
        selection: { anchor: from + insert.length },
      });
    },
  }));
}

/**
 * The second `{` writes the rest of the placeholder and opens the list.
 *
 * Bracket closing proper is the language's job and there is no language here that knows
 * about braces, so this is a plain input handler. It fires only on a `{` typed directly
 * after another one, which is a sequence that means nothing else in a mail body.
 */
export const braceOpener: Extension = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== "{" || from !== to) return false;
  if (view.state.doc.sliceString(Math.max(0, from - 1), from) !== "{") return false;

  view.dispatch({
    changes: { from, to, insert: "{  }}" },
    selection: { anchor: from + 2 },
    userEvent: "input.type",
  });
  startCompletion(view);
  return true;
});

/**
 * The variable list, offered inside a braced run and on an explicit request anywhere.
 *
 * A source rather than a configured `autocompletion()`, because the HTML editor needs two
 * of them. `override` replaces the whole source list, so an extension that configured
 * completion here would silently take tag and attribute completion away from the body
 * editor, which is the other half of what makes it an editor rather than a textarea.
 */
export function templateCompletionSource(
  scope: () => TemplateScope,
): (context: CompletionContext) => CompletionResult | null {
  return (context) => {
    const typing = context.matchBefore(TYPING);
    if (typing === null) {
      if (!context.explicit) return null;
      /* Asked for outside a placeholder: offer the names, and let `apply` write the
         braces, so the reader gets a working placeholder rather than a bare word. */
      const word = context.matchBefore(/[a-zA-Z0-9_.]*/);
      return {
        from: word?.from ?? context.pos,
        options: completionsFor(scope()).map((option) => ({
          ...option,
          apply: `{{ ${option.label} }}`,
        })),
      };
    }

    const name = TYPING.exec(typing.text)?.[1] ?? "";
    return {
      from: typing.to - name.length,
      options: completionsFor(scope()),
      validFor: /^[a-zA-Z0-9_.]*$/,
    };
  };
}

/**
 * The squiggles, and the sentence behind each one.
 *
 * Two severities, and they are not the same problem. An unknown name is an error: binding
 * fails closed, so the mail is not sent at all and a user is left unable to sign in. A run
 * that is not a placeholder is a warning: the mail is sent, and the reader gets the braces.
 * Marking both as errors would say the second cannot be saved, and it can.
 */
export function placeholderLint(scope: () => TemplateScope): Extension {
  return linter(
    (view) => {
      const known = new Set<string>(scope().variables);
      const diagnostics: Diagnostic[] = [];

      for (const match of scanPlaceholders(view.state.doc.toString())) {
        if (match.name === null) {
          diagnostics.push({
            from: match.from,
            to: match.to,
            severity: "warning",
            message:
              "Not a placeholder. The template language is substitution only, so this is sent to the reader exactly as typed.",
          });
          continue;
        }
        if (!known.has(match.name)) {
          diagnostics.push({
            from: match.from,
            to: match.to,
            severity: "error",
            message: `This message does not carry ${match.name}. Binding fails closed, so the send would be refused rather than leaving a gap.`,
            actions: [...known].slice(0, 4).map((name) => ({
              name: `Use ${name}`,
              apply: (target, from, to) => {
                target.dispatch({ changes: { from, to, insert: `{{ ${name} }}` } });
              },
            })),
          });
        }
      }

      return diagnostics;
    },
    { delay: 250 },
  );
}

/**
 * Everything the template language contributes to an editor except the completion source,
 * which the component composes because the HTML body needs the language's own beside it.
 */
export function templateExtensions(scope: () => TemplateScope): Extension {
  return [placeholderMarks(scope), braceOpener, placeholderLint(scope)];
}

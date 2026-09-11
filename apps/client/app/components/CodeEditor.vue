<script setup lang="ts">
/**
 * The panel's editable code surface: CodeMirror 6, in the panel's own colours, with the
 * template language wired into it.
 *
 * One component for all three fields of an email template, and that is the decision worth
 * understanding. A subject is one line and a body is forty, but both are the same
 * language, so a subject typed in a `v-text-field` would be the one field where
 * `{{ user.mail }}` is not marked, not completed and not explained, which is precisely the
 * field where a customer types a variable from memory. `inline` is a shape, not a
 * different editor.
 *
 * **Why CodeMirror and not Monaco.** Monaco loads its language services from separate
 * worker URLs; this panel is statically generated with no server of its own and allows no
 * third-party origin (PROJECT.md 10.3), so those workers have nowhere to come from. It is
 * also unusable on a touch screen, and `notes/email-templates.md` specifies a mobile
 * arrangement for this workspace. CodeMirror is a tenth of the weight, handles touch and
 * IME properly, and its completion and lint machinery is what serves the placeholder
 * intellisense in every field rather than only in the body.
 *
 * **What is bundled and what is not.** The HTML grammar is imported, never fetched, for
 * the same reason the icons and the Shiki grammars are. Nothing here reaches the network.
 *
 * **Tab is not captured.** CodeMirror's default leaves Tab to the browser, which is what
 * lets a keyboard user leave the field, and `indentWithTab` would take that away for the
 * sake of an indent the tidy button already does better.
 *
 * The one thing this shares with nothing else in the panel is that CodeMirror writes its
 * own stylesheet at runtime. The colours it computes are in `app/utils/code-theme.ts`,
 * built from the same palette Shiki's blocks use; everything a stylesheet can reach is in
 * the block at the foot of this file, so it follows Vuetify's theme class like the rest.
 */

import { autocompletion, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { html, htmlCompletionSource } from "@codemirror/lang-html";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { lintKeymap } from "@codemirror/lint";
import { Compartment, EditorState, type Extension, Prec } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as placeholderText,
  tooltips,
} from "@codemirror/view";
import { CODE_THEME_DARK, CODE_THEME_LIGHT } from "~/utils/code-theme";
import type { TemplateVariable } from "~/utils/email-templates";
import {
  braceOpener,
  placeholderLint,
  placeholderMarks,
  templateCompletionSource,
} from "~/utils/template-editor";

const props = withDefaults(
  defineProps<{
    /** `html` brings the grammar, the gutter and tag completion; `text` brings none of it. */
    language?: "html" | "text";
    /** One line, no gutter, no newlines: the shape a subject is typed in. */
    inline?: boolean;
    /** Everything this message may name, which is what the completion list offers. */
    variables?: readonly TemplateVariable[];
    /** Draws the field in the error colour. The lint marks say which characters. */
    invalid?: boolean;
    readonly?: boolean;
    /** Shown in the empty field. */
    placeholder?: string;
    /** What a screen reader calls the field. */
    label: string;
  }>(),
  {
    language: "text",
    inline: false,
    variables: () => [],
    invalid: false,
    readonly: false,
    placeholder: "",
  },
);

const model = defineModel<string>({ required: true });

const emit = defineEmits<{
  focus: [];
  blur: [];
}>();

const theme = useTheme();
const host = useTemplateRef<HTMLElement>("host");

let view: EditorView | null = null;
/* Set while the model is being written into the editor, so the editor's own change event
   does not write it straight back out and fight the caller's edit. */
let writing = false;

const themes = new Compartment();
const editable = new Compartment();

/** Vuetify's own root, which carries the theme class. The body is the fallback. */
function tooltipParent(): HTMLElement {
  return window.document.querySelector<HTMLElement>(".v-application") ?? window.document.body;
}

/* Read through a getter so the completion list and the marks follow a message whose scope
   changes without the editor being rebuilt. */
const scope = () => ({ variables: props.variables });

function baseExtensions(): Extension[] {
  const completionSources = [templateCompletionSource(scope)];
  if (props.language === "html") completionSources.push(htmlCompletionSource);

  return [
    history(),
    drawSelection(),
    /*
     * Tooltips are mounted on the application root rather than inside the editor, which is
     * the default. Every editor in this panel sits in a card that clips its overflow, so a
     * completion list is cut off at the card's edge: the names show and the sentence
     * explaining each one does not, which is the half worth reading.
     *
     * The application root and not `document.body`, because Vuetify's theme class is on the
     * root and a tooltip above it would be outside every `.v-theme--dark` rule in the panel:
     * a white menu in the dark theme, painted correctly only by accident in the light one.
     */
    tooltips({ parent: tooltipParent() }),
    highlightSpecialChars(),
    EditorState.allowMultipleSelections.of(true),
    /*
     * The completion keymap comes first so Enter accepts a suggestion, and the inline
     * field's own Enter handler sits after it and only sees the key when no list is open.
     */
    autocompletion({
      override: completionSources,
      icons: false,
      closeOnBlur: true,
      /* The list is short by design: six names at most, and usually four. */
      maxRenderedOptions: 12,
    }),
    keymap.of([...closeBracketsKeymap, ...historyKeymap, ...lintKeymap, ...defaultKeymap]),
    placeholderMarks(scope),
    braceOpener,
    placeholderLint(scope),
    themes.of(theme.current.value.dark ? CODE_THEME_DARK : CODE_THEME_LIGHT),
    editable.of([EditorState.readOnly.of(props.readonly), EditorView.editable.of(!props.readonly)]),
    EditorView.contentAttributes.of({ "aria-label": props.label }),
    EditorView.updateListener.of((update) => {
      if (update.focusChanged) {
        if (update.view.hasFocus) emit("focus");
        else emit("blur");
      }
      if (!update.docChanged || writing) return;
      model.value = update.state.doc.toString();
    }),
    ...(props.placeholder === "" ? [] : [placeholderText(props.placeholder)]),
    ...(props.inline ? inlineExtensions() : blockExtensions()),
  ];
}

/**
 * A single-line field.
 *
 * Newlines are folded to spaces rather than refused, because the refusal a reader meets is
 * a paste that did nothing: a subject copied out of a document carries a trailing newline
 * far more often than anybody intends one. `Prec.low` on the Enter handler leaves the key
 * to the completion list while a list is open.
 */
function inlineExtensions(): Extension[] {
  return [
    EditorState.transactionFilter.of((transaction) => {
      if (!transaction.docChanged || transaction.newDoc.lines === 1) return transaction;
      const flattened = transaction.newDoc.toString().replace(/\r?\n/g, " ");
      return {
        changes: { from: 0, to: transaction.startState.doc.length, insert: flattened },
        selection: { anchor: flattened.length },
      };
    }),
    Prec.low(keymap.of([{ key: "Enter", run: () => true }])),
  ];
}

/** A body: the gutter, the grammar and the brackets. */
function blockExtensions(): Extension[] {
  return [
    EditorView.lineWrapping,
    lineNumbers(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    keymap.of(foldKeymap),
    ...(props.language === "html"
      ? [html({ autoCloseTags: true, matchClosingTags: true }), foldGutter()]
      : []),
  ];
}

onMounted(() => {
  if (host.value === null) return;
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({ doc: model.value, extensions: baseExtensions() }),
  });
});

onBeforeUnmount(() => {
  view?.destroy();
  view = null;
});

/*
 * The model changing from outside is the tidy button, the insert menu, and a language
 * being switched under the editor. Compared before dispatching, because a round trip of
 * the editor's own change would otherwise reset the selection on every keystroke.
 */
watch(model, (next) => {
  if (view === null || next === view.state.doc.toString()) return;
  writing = true;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
  writing = false;
});

watch(
  () => theme.current.value.dark,
  (dark) => {
    view?.dispatch({
      effects: themes.reconfigure(dark ? CODE_THEME_DARK : CODE_THEME_LIGHT),
    });
  },
);

watch(
  () => props.readonly,
  (locked) => {
    view?.dispatch({
      effects: editable.reconfigure([
        EditorState.readOnly.of(locked),
        EditorView.editable.of(!locked),
      ]),
    });
  },
);

/**
 * Writes at the cursor, which is what the insert-variable menu calls.
 *
 * The editor is focused first and the selection put after what was written, so the reader
 * carries on typing where the placeholder ended rather than wherever they last clicked.
 */
function insert(text: string) {
  if (view === null) return;
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    scrollIntoView: true,
  });
  view.focus();
}

function focus() {
  view?.focus();
}

defineExpose({ insert, focus });
</script>

<template>
  <div
    :class="[
      invalid ? 'editor--invalid' : 'border-line',
      inline ? 'editor--inline' : '',
      readonly ? 'opacity-70' : '',
    ]"
    class="editor flex min-h-0 min-w-0 flex-col overflow-hidden rounded-(--idenzy-radius-small) border bg-surface"
  >
    <div ref="host" class="editor__host flex min-h-0 min-w-0 flex-1 flex-col" />
  </div>
</template>

<style scoped>
/*
 * Everything a stylesheet can reach. What is not here is in app/utils/code-theme.ts,
 * because CodeMirror computes the selection layer, the cursor and its own tooltips into an
 * inline stylesheet and a rule of ours cannot get at them.
 */
.editor {
  transition: border-color 150ms ease;
}

.editor:focus-within {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 1px rgb(var(--v-theme-primary));
}

.editor--invalid {
  border-color: rgb(var(--v-theme-error));
}

.editor--invalid:focus-within {
  border-color: rgb(var(--v-theme-error));
  box-shadow: 0 0 0 1px rgb(var(--v-theme-error));
}

.editor__host :deep(.cm-editor) {
  flex: 1;
  min-height: 0;
  /* The wrapper draws the ring; a second one inside it reads as two fields. */
  outline: none !important;
}

.editor__host :deep(.cm-scroller) {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.5rem;
  overflow: auto;
}

.editor__host :deep(.cm-content) {
  padding: 8px 0;
}

.editor__host :deep(.cm-line) {
  padding: 0 12px;
}

.editor__host :deep(.cm-gutters) {
  padding-left: 4px;
  user-select: none;
}

.editor__host :deep(.cm-lineNumbers .cm-gutterElement) {
  min-width: 24px;
  padding: 0 6px 0 4px;
}

/* A single-line field is the height of the small controls beside it. */
.editor--inline .editor__host :deep(.cm-content) {
  padding: 0;
}

.editor--inline .editor__host :deep(.cm-line) {
  line-height: 2.25rem;
  padding: 0 12px;
}

.editor--inline .editor__host :deep(.cm-scroller) {
  line-height: 2.25rem;
}

/*
 * The three things a braced run can be.
 *
 * A known name is tinted the accent and set on a wash of it, so a body reads as copy with
 * values in it. The other two carry a wavy underline as well as a colour, because a tint
 * alone is not a statement and this is the panel's one surface where the difference
 * decides whether a mail is sent at all.
 */
.editor__host :deep(.cm-tpl) {
  border-radius: 4px;
  padding: 1px 0;
}

.editor__host :deep(.cm-tpl--known) {
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 12%, transparent);
  color: rgb(var(--v-theme-primary));
}

.editor__host :deep(.cm-tpl--unknown) {
  background: color-mix(in srgb, rgb(var(--v-theme-error)) 12%, transparent);
  color: rgb(var(--v-theme-error));
  text-decoration: underline wavy rgb(var(--v-theme-error));
  text-underline-offset: 3px;
}

.editor__host :deep(.cm-tpl--malformed) {
  background: color-mix(in srgb, rgb(var(--v-theme-warning)) 14%, transparent);
  color: rgb(var(--v-theme-warning));
  text-decoration: underline wavy rgb(var(--v-theme-warning));
  text-underline-offset: 3px;
}

.editor__host :deep(.cm-placeholder) {
  color: rgba(var(--v-theme-on-surface), 0.4);
}
</style>

<style>
/*
 * The completion list and the lint message.
 *
 * Unscoped, for the same reason MetricChart's tooltip block is: this markup is CodeMirror's
 * and is mounted on the application root so a card cannot clip it, so it is not a
 * descendant of this component and a scoped rule reaches none of it. Every selector is
 * under one of CodeMirror's own `cm-tooltip` classes, which nothing else in the panel uses.
 *
 * The shape is the panel's menu, because it is a menu: the surface, the hairline, the
 * radius and the small type every other menu here is built from.
 *
 * Every selector here carries at least two classes, and that is load-bearing rather than
 * decorative. CodeMirror copies its generated theme classes onto the container it mounts a
 * tooltip in, so its own defaults arrive as `.<generated> .cm-tooltip`: two classes, which
 * a bare `.cm-tooltip` of ours loses to however late it appears. Matching that count is
 * enough because ties go to the later sheet and CodeMirror's is always earlier, since
 * `StyleModule` inserts itself as the first child of `<head>`.
 */
.v-application .cm-tooltip {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: var(--idenzy-radius-small);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
  color: rgb(var(--v-theme-on-surface));
  overflow: hidden;
}

.cm-tooltip .cm-tooltip-arrow::before {
  border-top-color: rgba(var(--v-border-color), var(--v-border-opacity));
  border-bottom-color: rgba(var(--v-border-color), var(--v-border-opacity));
}

.cm-tooltip .cm-tooltip-arrow::after {
  border-top-color: rgb(var(--v-theme-surface));
  border-bottom-color: rgb(var(--v-theme-surface));
}

.cm-tooltip.cm-tooltip-autocomplete > ul {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  max-height: 17rem;
  min-width: 15rem;
}

/*
 * The name over the sentence, not beside it, which is the same row the Insert variable
 * menu draws. Beside it was the first arrangement and it does not survive: CodeMirror's
 * list is a scroll container, so a row wider than the list is clipped rather than wrapped,
 * and the half that gets cut is always the explanation.
 */
.cm-tooltip.cm-tooltip-autocomplete > ul > li {
  align-items: flex-start;
  color: rgb(var(--v-theme-on-surface));
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 5px 10px;
}

.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected] {
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 14%, transparent);
  color: rgb(var(--v-theme-on-surface));
}

.cm-tooltip .cm-completionLabel {
  color: rgb(var(--v-theme-primary));
  font-weight: 500;
}

/* The name is what is being chosen; the sentence beside it steps back and sets in the
   panel's own face, because it is prose and not code. */
.cm-tooltip .cm-completionDetail {
  color: rgba(var(--v-theme-on-surface), 0.55);
  /* Named rather than inherited: the list itself is set in the mono face, because a
     variable name is code, and the sentence explaining it is not. */
  font-family: var(--v-font-body);
  font-size: 0.6875rem;
  font-style: normal;
  line-height: 1rem;
  margin-left: 0;
  white-space: normal;
}

.cm-tooltip .cm-completionMatchedText {
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
  font-weight: 700;
}

.cm-tooltip.cm-completionInfo {
  background: rgb(var(--v-theme-surface));
  font-family: var(--v-font-body);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: var(--idenzy-radius-small);
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.6875rem;
  line-height: 1rem;
  max-width: 17rem;
  padding: 8px 10px;
}

/* The lint message, and the "Use link" fixes it offers. */
.cm-tooltip .cm-diagnostic {
  border-left-width: 3px;
  font-family: var(--v-font-body);
  font-size: 0.6875rem;
  line-height: 1rem;
  max-width: 22rem;
  padding: 7px 10px;
}

.cm-tooltip .cm-diagnostic-error {
  border-left-color: rgb(var(--v-theme-error));
}

.cm-tooltip .cm-diagnostic-warning {
  border-left-color: rgb(var(--v-theme-warning));
}

.cm-tooltip .cm-diagnosticAction {
  background: color-mix(in srgb, rgb(var(--v-theme-on-surface)) 10%, transparent);
  border-radius: 6px;
  color: inherit;
  font-weight: 500;
  margin-left: 6px;
  padding: 1px 6px;
}
</style>

<script setup lang="ts">
/**
 * The editor for one transactional mail: the three bodies on the left, what they render
 * to on the right, and the variables in scope between them.
 *
 * A preview and not a description, because a subject line with a code in it and a subject
 * line that says a code goes here are different things, and the second is the one that
 * ships wrong. The HTML is rendered in a fully sandboxed iframe: the body is customer
 * content, and `v-html` would run an `onerror` on an image even though it would not run a
 * script tag. The sandbox attribute is empty on purpose, which is the most restrictive
 * value there is, so the frame gets an opaque origin and no scripts, forms or navigation.
 *
 * Locale lives in the header rather than in a screen behind this one, because translating
 * is the work: an author moves between `en` and `tr` on the same copy, and a dialog per
 * language would make them close and reopen for every line. A locale with nothing stored
 * opens on our built-in, which is a starting point rather than a blank page.
 *
 * Saving is whole. The three bodies are one message, and a subject stored against a body
 * somebody else replaced is a mail nobody wrote.
 */

import type { StoredTemplate } from "~/stores/email-templates";
import {
  catalogueEntry,
  DEFAULT_LOCALE,
  type EmailTemplateType,
  hasIssues,
  normalizeLocale,
  renderPreview,
  sampleValues,
  startingPoint,
  TEMPLATE_ISSUE_LABELS,
  type TemplateBodies,
  toPlainText,
  validateTemplate,
  variablesInScope,
} from "~/utils/email-templates";

const props = defineProps<{
  type: EmailTemplateType;
  /** Every locale the project has copy for, so the header can offer them. */
  locales: readonly string[];
  /** The locale to open on. */
  initialLocale: string;
  /** Looks a stored row up, so switching locale inside the dialog costs no round trip. */
  find: (type: EmailTemplateType, locale: string) => StoredTemplate | null;
  projectName: string;
  expiresInSeconds: number;
  saving: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  save: [locale: string, draft: TemplateBodies];
  revert: [locale: string];
}>();

const entry = computed(() => catalogueEntry(props.type));
const locale = ref(props.initialLocale);
const draft = ref<TemplateBodies>({ subject: "", html: "", text: "" });

/** The row behind the locale on screen, or null where the built-in is what would send. */
const stored = computed(() => props.find(props.type, locale.value));

/* Reloading on every locale change is what makes the header a switch rather than a tab
   bar over one draft: an edit belongs to the language it was typed in. */
function load() {
  const row = stored.value;
  draft.value =
    row === null
      ? startingPoint(props.type)
      : { subject: row.subject, html: row.html, text: row.text };
}

watch(
  [() => open.value, () => props.type, () => props.initialLocale],
  ([isOpen]) => {
    if (!isOpen) return;
    locale.value = props.initialLocale;
    load();
  },
  { immediate: true },
);

watch(locale, load);

/* The locales on offer: what the project holds, plus the one our own copy is written in. */
const localeOptions = computed(() => {
  const held = new Set([...props.locales, DEFAULT_LOCALE, locale.value]);
  return [...held].sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: value }));
});

/* Adding a language is a field that appears in place of the button, because a dialog on
   top of a dialog for one text input is a step nobody needs. */
const adding = ref(false);
const newLocale = ref("");
const newLocaleField = useTemplateRef<{ focus: () => void }>("newLocaleField");

const newLocaleIssue = computed(() => {
  const value = newLocale.value.trim();
  if (value === "") return "";
  const normalized = normalizeLocale(value);
  if (normalized === null) return "A language tag looks like en, tr or pt-BR.";
  if (localeOptions.value.some((option) => option.value === normalized)) {
    return `${normalized} is already on the list.`;
  }
  return "";
});

function startAdding() {
  adding.value = true;
  newLocale.value = "";
  void nextTick(() => newLocaleField.value?.focus());
}

function addLocale() {
  const normalized = normalizeLocale(newLocale.value);
  if (normalized === null || newLocaleIssue.value !== "") return;
  adding.value = false;
  locale.value = normalized;
}

/*
 * Validity, from the same rules the renderer resolves against. The list on the right is
 * the whole of what a body may reference, and anything else fails the send rather than
 * rendering a gap.
 */
const scope = computed(() => variablesInScope(props.type));
const issues = computed(() => validateTemplate(draft.value, props.type));
const invalid = computed(() => hasIssues(issues.value));

const dirty = computed(() => {
  const row = stored.value;
  if (row === null) return true;
  return (
    row.subject !== draft.value.subject ||
    row.html !== draft.value.html ||
    row.text !== draft.value.text
  );
});

const canSave = computed(() => dirty.value && !invalid.value && !props.saving);

/*
 * The preview, substituted exactly as the renderer would: escaped in the HTML body,
 * literal in the subject and the text part.
 */
const values = computed(() =>
  sampleValues({ projectName: props.projectName, expiresInSeconds: props.expiresInSeconds }),
);

const preview = reactive({ pane: "html" });

const renderedSubject = computed(() => renderPreview(draft.value.subject, values.value, "text"));
const renderedHtml = computed(() => renderPreview(draft.value.html, values.value, "html"));
const renderedText = computed(() => renderPreview(draft.value.text, values.value, "text"));

const PREVIEW_PANES = [
  { value: "html", label: "HTML" },
  { value: "text", label: "Plain text" },
];

function generateText() {
  draft.value.text = toPlainText(draft.value.html);
}

function submit() {
  if (!canSave.value) return;
  emit("save", locale.value, { ...draft.value });
}

const subjectId = `${useId()}-subject`;
const htmlId = `${useId()}-html`;
const textId = `${useId()}-text`;
</script>

<template>
  <v-dialog v-model="open" max-width="1120" scrollable>
    <v-card v-if="entry" border flat>
      <form class="flex max-h-[86vh] flex-col" @submit.prevent="submit">
        <header class="flex flex-col gap-3 border-b border-line px-5 py-4">
          <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div class="flex min-w-0 flex-col gap-0.5">
              <div class="flex flex-wrap items-center gap-2">
                <h2 class="m-0 text-sm font-medium text-ink">{{ entry.label }}</h2>
                <StatusBadge
                  :label="stored ? `Yours · v${stored.version}` : 'Built-in'"
                  :tone="stored ? 'success' : 'neutral'"
                />
                <StatusBadge v-if="!entry.live" label="Not sent yet" tone="warning" />
                <StatusBadge
                  v-else-if="stored && !stored.compiled"
                  label="Compiling"
                  tone="warning"
                />
              </div>
              <p class="m-0 text-xs leading-5 text-ink/60">{{ entry.note }}</p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <span class="text-[11px] font-medium text-ink/55">Language</span>
            <SegmentedControl v-model="locale" :options="localeOptions" label="Language" />
            <template v-if="adding">
              <v-text-field
                ref="newLocaleField"
                v-model="newLocale"
                :error="newLocaleIssue !== ''"
                aria-label="New language tag"
                autocomplete="off"
                class="template-dialog__locale w-32"
                density="compact"
                hide-details
                placeholder="pt-BR"
                variant="outlined"
                @keydown.enter.prevent="addLocale"
              />
              <v-btn
                :disabled="newLocale.trim() === '' || newLocaleIssue !== ''"
                class="text-xs font-medium"
                color="primary"
                size="small"
                variant="text"
                @click="addLocale"
              >
                Add
              </v-btn>
              <span v-if="newLocaleIssue" class="text-[11px] text-error">
                {{ newLocaleIssue }}
              </span>
            </template>
            <v-btn
              v-else
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:add"
              size="small"
              variant="text"
              @click="startAdding"
            >
              Add a language
            </v-btn>
          </div>
        </header>

        <div class="grid min-h-0 flex-1 gap-0 overflow-y-auto lg:grid-cols-2 lg:overflow-hidden">
          <!-- The three bodies. -->
          <!-- Every group is `shrink-0`, and that is what stops the fields being squeezed:
               a flex child shrinks below its content by default, and a textarea sized by
               `rows` then overflows its own box onto whatever follows instead of the
               column scrolling. -->
          <div class="flex min-w-0 flex-col gap-4 p-5 lg:overflow-y-auto">
            <div class="flex shrink-0 flex-col gap-1.5">
              <label :for="subjectId" class="text-xs font-medium text-ink">Subject</label>
              <v-text-field
                :id="subjectId"
                v-model="draft.subject"
                :error="issues.subject.length > 0"
                autocomplete="off"
                class="font-mono"
                density="compact"
                hide-details
                variant="filled"
              />
              <p
                v-for="issue in issues.subject"
                :key="issue"
                class="m-0 flex items-start gap-1.5 text-[11px] leading-4 text-error"
              >
                <Icon
                  aria-hidden="true"
                  class="mt-px flex-none text-sm"
                  name="material-symbols:error-outline"
                />
                {{ TEMPLATE_ISSUE_LABELS[issue] }}
              </p>
            </div>

            <div class="flex shrink-0 flex-col gap-1.5">
              <label :for="htmlId" class="text-xs font-medium text-ink">HTML body</label>
              <v-textarea
                :id="htmlId"
                v-model="draft.html"
                :error="issues.html.length > 0"
                auto-grow
                class="template-dialog__code"
                hide-details
                rows="12"
                variant="outlined"
              />
              <p
                v-for="issue in issues.html"
                :key="issue"
                class="m-0 flex items-start gap-1.5 text-[11px] leading-4 text-error"
              >
                <Icon
                  aria-hidden="true"
                  class="mt-px flex-none text-sm"
                  name="material-symbols:error-outline"
                />
                {{ TEMPLATE_ISSUE_LABELS[issue] }}
              </p>
            </div>

            <div class="flex shrink-0 flex-col gap-1.5">
              <div class="flex items-center justify-between gap-3">
                <label :for="textId" class="text-xs font-medium text-ink">Plain text</label>
                <v-btn
                  class="text-xs font-medium"
                  color="neutral"
                  prepend-icon="material-symbols:auto-fix-high-outline"
                  size="x-small"
                  variant="text"
                  @click="generateText"
                >
                  Draft from the HTML
                </v-btn>
              </div>
              <v-textarea
                :id="textId"
                v-model="draft.text"
                :error="issues.text.length > 0"
                auto-grow
                class="template-dialog__code"
                hide-details
                rows="7"
                variant="outlined"
              />
              <p class="m-0 text-[11px] leading-4 text-ink/50">
                Written rather than generated, because this is what a screen reader and a
                spam filter read, and a mechanical strip of the HTML reads like one.
              </p>
              <p
                v-for="issue in issues.text"
                :key="issue"
                class="m-0 flex items-start gap-1.5 text-[11px] leading-4 text-error"
              >
                <Icon
                  aria-hidden="true"
                  class="mt-px flex-none text-sm"
                  name="material-symbols:error-outline"
                />
                {{ TEMPLATE_ISSUE_LABELS[issue] }}
              </p>
            </div>
          </div>

          <!-- What it renders to, and what it may reference. -->
          <div
            class="flex min-w-0 flex-col gap-4 border-t border-line bg-canvas/60 p-5 lg:overflow-y-auto lg:border-t-0 lg:border-l"
          >
            <div class="flex shrink-0 flex-col gap-1.5">
              <span class="text-xs font-medium text-ink">In scope for this message</span>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="name in scope"
                  :key="name"
                  class="inline-flex rounded-full border border-line bg-surface px-2 py-0.5 font-mono text-[11px] leading-4 text-ink/75"
                >
                  {{ name }}
                </span>
              </div>
              <p class="m-0 text-[11px] leading-4 text-ink/55">
                The whole language is
                <span v-pre class="font-mono text-ink/75">{{ name }}</span> substitution:
                no conditionals, no loops, no helpers. Anything else in braces is sent as
                typed, and a name outside this list fails the send rather than leaving a
                gap.
              </p>
            </div>

            <div class="flex min-w-0 shrink-0 flex-col gap-2">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="text-xs font-medium text-ink">Preview</span>
                <SegmentedControl v-model="preview.pane" :options="PREVIEW_PANES" label="Preview" />
              </div>

              <div
                class="overflow-hidden rounded-(--idenzy-radius-small) border border-line bg-surface"
              >
                <div class="flex flex-col gap-0.5 border-b border-line px-3 py-2">
                  <span class="text-[10px] leading-4 text-ink/45">Subject</span>
                  <span class="truncate text-xs font-medium text-ink">
                    {{ renderedSubject || "—" }}
                  </span>
                </div>
                <!-- Sandboxed with the most restrictive value there is: an opaque origin,
                     no scripts, no forms, no navigation. The body is customer content. -->
                <iframe
                  v-if="preview.pane === 'html'"
                  :srcdoc="renderedHtml"
                  class="block h-80 w-full border-0 bg-white"
                  sandbox=""
                  title="Rendered email"
                />
                <pre
                  v-else
                  class="m-0 h-80 overflow-auto p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap text-ink"
                >{{ renderedText }}</pre>
              </div>
              <p class="m-0 text-[11px] leading-4 text-ink/50">
                Sample values, substituted as the renderer would: escaped in the HTML,
                literal in the subject and the text part. A placeholder with nothing to put
                there is left standing.
              </p>
            </div>
          </div>
        </div>

        <footer class="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
          <v-btn
            v-if="stored"
            :disabled="saving"
            class="text-xs font-medium"
            color="neutral"
            prepend-icon="material-symbols:undo"
            size="small"
            variant="text"
            @click="emit('revert', locale)"
          >
            Revert to the built-in
          </v-btn>
          <span v-else class="text-[11px] text-ink/50">
            Nothing stored for {{ locale }}. Saving adds it.
          </span>

          <div class="flex items-center gap-2">
            <v-btn
              class="text-xs font-medium"
              color="neutral"
              size="small"
              variant="text"
              @click="open = false"
            >
              Cancel
            </v-btn>
            <v-btn
              :disabled="!canSave"
              :loading="saving"
              class="text-xs font-medium"
              color="primary"
              size="small"
              type="submit"
              variant="flat"
            >
              Save {{ locale }}
            </v-btn>
          </div>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>

<style scoped>
/*
 * The two bodies are code and are set as code.
 *
 * The rule reaches the textarea rather than sitting on the component's root, because a
 * size class on the root changes the wrapper and not the element inside it.
 *
 * `auto-grow` on both fields is load-bearing rather than a nicety. This panel states an
 * explicit control height on every field and zeroes the padding hooks, which is what pulls
 * an underline up against a single-line input; a textarea sized only by `rows` then draws
 * itself taller than the 40px box that was measured for it and overlaps whatever follows.
 * Growing the field to its content is what keeps the two in step, and it is what the one
 * other textarea in the panel already does.
 */
.template-dialog__code :deep(textarea) {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.5;
}

/* The language field sits in a row of small controls and has to match their height. */
.template-dialog__locale :deep(.v-field) {
  --v-input-control-height: 28px;

  border-radius: var(--idenzy-radius-x-small);
  font-size: 0.75rem;
}

.template-dialog__locale :deep(.v-field__input) {
  font-size: 0.75rem;
  min-height: 28px;
  padding-top: 0;
}
</style>

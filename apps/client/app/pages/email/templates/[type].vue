<script setup lang="ts">
/**
 * The editing workspace for one transactional message: languages on the left, the three
 * bodies in the middle, what a reader receives on the right
 * (`notes/email-templates.md`, PROJECT.md 11.3).
 *
 * **A page and not a dialog, and that is the finding this screen was rebuilt for.** The
 * editor holds language management, three bodies, a live preview, validation and
 * reversion; a modal put all of it over a page it had hidden, reloaded its draft whenever
 * the language changed, and threw the work away on Escape without asking. So it has a URL
 * that can be linked to and returned to, drafts that live in the store rather than in this
 * component, and a guard on every way out.
 *
 * **A draft is per language and survives everything but a reload.** Switching language,
 * walking back to the catalogue and coming in again all preserve it, because the drafts
 * are the store's. The language list marks which ones hold unpublished work, so a
 * translator who has edited three of them can see that from any one of them.
 *
 * **Publish writes every language that has unsaved copy, not the one on screen.** A button
 * that saved only the current language would leave the other two unpublished and say
 * nothing, which is the same silent loss in a different place. It is named after what it
 * does, so it says "Publish 2 languages" when that is what it would do.
 *
 * **Published is not sending.** A body is compiled off the request path, and until that
 * has happened our built-in is what goes out. That window is a state of its own in the
 * toolbar and on the language list, because it is the one thing an operator has no other
 * way to see.
 *
 * The three fields are one editor in three shapes (`CodeEditor.vue`). A subject typed in
 * an ordinary text input would be the one field where a mistyped variable is not marked,
 * not completed and not explained, and it is the field most often typed from memory.
 */

import type { LanguageEntry } from "~/components/EmailLanguageList.vue";
import {
  BUILT_IN,
  catalogueEntry,
  DEFAULT_LOCALE,
  type EmailTemplateType,
  hasIssues,
  localeChain,
  localeStatusOf,
  normalizeLocale,
  renderPreview,
  resolve,
  sampleValues,
  startingPoint,
  TEMPLATE_ISSUE_LABELS,
  type TemplateBodies,
  toPlainText,
  validateTemplate,
  variablesInScope,
} from "~/utils/email-templates";
import { formatHtml, needsFormatting } from "~/utils/html-format";
import { CODE } from "~/utils/otp";
import { fromAddress, SHARED_DOMAIN, senderLine } from "~/utils/sending-domains";
import { formatDateTime, relativeTimeWords } from "~/utils/time";

const route = useRoute();
const router = useRouter();
const projects = useProjectStore();
const store = useEmailTemplatesStore();
const domains = useSendingDomainsStore();

const now = useNow({ interval: 30_000 });

const type = computed(() => route.params.type as EmailTemplateType);
const entry = computed(() => catalogueEntry(type.value));

usePageCrumb(() => entry.value?.label ?? "Message");

/*
 * The language, in the query rather than the path.
 *
 * It is a view of one message and not a resource of its own, and a link somebody is asked
 * to look at has to carry it. Replaced rather than pushed for the same reason the one-time
 * codes screen replaces its tab: moving between languages is not navigation to step back
 * through, and a reader who edited four of them should not have to press Back four times
 * to leave.
 */
const locale = computed<string>({
  get: () => {
    const asked = route.query.lang;
    const value = Array.isArray(asked) ? asked[0] : asked;
    return (typeof value === "string" ? normalizeLocale(value) : null) ?? defaultLocale.value;
  },
  set: (value) => {
    void router.replace({ query: { ...route.query, lang: value } });
  },
});

/** The language a send would use today, which is the one worth opening on. */
const defaultLocale = computed(() => {
  const sending = store
    .localesFor(projects.current.id, type.value)
    .filter((held) => store.find(projects.current.id, type.value, held)?.compiled === true);
  const resolution = resolve(DEFAULT_LOCALE, sending);
  return resolution.source === "yours" ? resolution.locale : DEFAULT_LOCALE;
});

const stored = computed(() => store.find(projects.current.id, type.value, locale.value));
const scope = computed(() => variablesInScope(type.value));

/*
 * The three bodies, read from the store and written back to it on every keystroke.
 *
 * Computed setters rather than a local object, so there is one copy of the draft and it is
 * the one the catalogue reads, the leave guard reads and the language list marks. A local
 * copy synchronised back is the arrangement the old dialog had, and it is what lost the
 * work on a language change.
 */
const bodies = computed(() => store.bodiesFor(projects.current.id, type.value, locale.value));

function edit(patch: Partial<TemplateBodies>) {
  store.setDraft(projects.current.id, type.value, locale.value, { ...bodies.value, ...patch });
}

const subject = computed<string>({
  get: () => bodies.value.subject,
  set: (value) => edit({ subject: value }),
});
const htmlBody = computed<string>({
  get: () => bodies.value.html,
  set: (value) => edit({ html: value }),
});
const textBody = computed<string>({
  get: () => bodies.value.text,
  set: (value) => edit({ text: value }),
});

/*
 * Validity, from the same rules the renderer resolves against and the editor marks with.
 */
const issues = computed(() => validateTemplate(bodies.value, type.value));
const invalid = computed(() => hasIssues(issues.value));

/*
 * Unsaved work, per language and across the message.
 */
const dirtyLocales = computed(() => store.dirtyLocales(projects.current.id, type.value));
const dirty = computed(() => dirtyLocales.value.length > 0);

/** A language with unsaved copy the server would refuse. Publishing waits on all of them. */
const problems = computed(() =>
  dirtyLocales.value
    .map((held) => ({
      locale: held,
      issues: validateTemplate(store.bodiesFor(projects.current.id, type.value, held), type.value),
    }))
    .filter((held) => hasIssues(held.issues)),
);

const elsewhere = computed(() => problems.value.filter((held) => held.locale !== locale.value));

const saving = ref(false);
const canPublish = computed(() => dirty.value && problems.value.length === 0 && !saving.value);

const publishLabel = computed(() => {
  if (dirtyLocales.value.length === 0) return "Publish";
  if (dirtyLocales.value.length === 1) return `Publish ${dirtyLocales.value[0]}`;
  return `Publish ${dirtyLocales.value.length} languages`;
});

const blockedReason = computed(() => {
  if (problems.value.length === 0) return "";
  const named = problems.value.map((held) => held.locale).join(", ");
  return problems.value.length === 1
    ? `${named} has a problem that stops the send.`
    : `${named} have problems that stop the send.`;
});

/**
 * The write, against the project the drafts belong to and never the one showing later.
 *
 * Every unsaved language, in one action, because that is what the button says. The rows
 * come back uncompiled, as they do from the server, and the toolbar says so until the
 * worker pool has been past.
 */
async function publish(): Promise<boolean> {
  if (!canPublish.value) return false;
  const projectId = projects.current.id;
  const message = type.value;
  const pending = [...dirtyLocales.value];
  saving.value = true;
  try {
    for (const held of pending) {
      await store.save(
        projectId,
        message,
        held,
        { ...store.bodiesFor(projectId, message, held) },
        "hasan@example.com",
      );
    }
    notify(
      pending.length === 1
        ? `${entry.value?.label} published for ${pending[0]}`
        : `${entry.value?.label} published for ${pending.length} languages`,
    );
    return true;
  } finally {
    saving.value = false;
  }
}

/* Cmd+S and Ctrl+S publish, because an editor with a save button is expected to. */
useEventListener(window, "keydown", (event: KeyboardEvent) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void publish();
  }
});

/*
 * Discarding, reverting, and the difference.
 *
 * Discard throws away the unsaved copy for this language and leaves what is published
 * alone. Revert removes the published copy itself, which is a different decision with a
 * different consequence, and it has a dialog because the copy that takes over is rarely
 * the one somebody expects.
 */
function discardLocale() {
  store.clearDraft(projects.current.id, type.value, locale.value);
}

function discardAll() {
  for (const held of dirtyLocales.value) {
    store.clearDraft(projects.current.id, type.value, held);
  }
}

const revertDialog = ref(false);

/** What a reader in this language would get once this language's copy is gone. */
const fallback = computed(() => {
  const sending = store
    .localesFor(projects.current.id, type.value)
    .filter(
      (held) =>
        held !== locale.value &&
        store.find(projects.current.id, type.value, held)?.compiled === true,
    );
  const resolution = resolve(locale.value, sending);
  const row =
    resolution.source === "yours"
      ? store.find(projects.current.id, type.value, resolution.locale)
      : null;
  const source = row?.subject ?? BUILT_IN[type.value]?.subject ?? "";
  return {
    locale: resolution.locale,
    source: resolution.source,
    subject: renderPreview(source, values.value, "text"),
  };
});

async function confirmRevert() {
  const held = locale.value;
  saving.value = true;
  try {
    await store.revert(projects.current.id, type.value, held);
    revertDialog.value = false;
    notify(`${entry.value?.label} is back to the built-in for ${held}`);
  } finally {
    saving.value = false;
  }
}

/*
 * The language list.
 */
const languages = computed<LanguageEntry[]>(() => {
  const held = new Set([
    ...store.localesFor(projects.current.id, type.value),
    ...store.draftLocales(projects.current.id, type.value),
    DEFAULT_LOCALE,
    locale.value,
  ]);
  return [...held]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => {
      const row = store.find(projects.current.id, type.value, value);
      return {
        locale: value,
        status: localeStatusOf({
          dirty: store.isDirty(projects.current.id, type.value, value),
          stored: row !== null,
          compiled: row?.compiled ?? false,
        }),
      };
    });
});

/** Languages a new one may be seeded from: the ones that already carry copy of their own. */
const seedSources = computed(() =>
  languages.value.filter((held) => held.status !== "none").map((held) => held.locale),
);

function addLanguage(added: string, from: string | null) {
  const seed =
    from === null
      ? startingPoint(type.value)
      : store.bodiesFor(projects.current.id, type.value, from);
  store.setDraft(projects.current.id, type.value, added, { ...seed });
  locale.value = added;
}

/*
 * The preview. Substituted exactly as the renderer would: escaped in the HTML body,
 * literal in the subject and the text part.
 */
const expiresInSeconds = CODE.lifetimeSeconds;
const values = computed(() =>
  sampleValues({ projectName: projects.current.name, expiresInSeconds }),
);

const renderedSubject = computed(() => renderPreview(subject.value, values.value, "text"));
const renderedHtml = computed(() => renderPreview(htmlBody.value, values.value, "html"));
const renderedText = computed(() => renderPreview(textBody.value, values.value, "text"));

/** The address the deployment sends from, so the preview's header is a real header. */
const sender = computed(() => {
  const domain = domains.sendingFor(projects.current.id);
  return domain === null
    ? fromAddress(SHARED_DOMAIN)
    : senderLine(projects.current.name, domain.domain);
});

const viewport = ref<"desktop" | "mobile">("desktop");
const VIEWPORTS = [
  { value: "desktop", icon: "material-symbols:desktop-windows-outline", title: "Desktop, 600px" },
  { value: "mobile", icon: "material-symbols:smartphone", title: "Phone, 375px" },
];

/*
 * Which body is being edited, and the preview follows it: a plain-text part previewed
 * beside a rendered HTML body is two different messages on one screen.
 */
const bodyTab = ref<"html" | "text">("html");
const BODY_TABS = [
  { value: "html", label: "HTML" },
  { value: "text", label: "Plain text" },
];

/* Which pane a phone is showing. A viewport arrangement rather than a place, so it is not
   in the URL: there is nothing here to link somebody to. */
const pane = ref("editor");
const PANE_OPTIONS = [
  { value: "editor", label: "Content", icon: "material-symbols:edit-outline" },
  { value: "preview", label: "Preview", icon: "material-symbols:visibility-outline" },
];

/*
 * The two things the body editor's own toolbar does.
 */
const subjectEditor = useTemplateRef<{ insert: (text: string) => void }>("subjectEditor");
const bodyEditor = useTemplateRef<{ insert: (text: string) => void }>("bodyEditor");
const focusedField = ref<"subject" | "body">("body");

function insertVariable(text: string) {
  if (focusedField.value === "subject") subjectEditor.value?.insert(text);
  else bodyEditor.value?.insert(text);
}

const tidyable = computed(() => needsFormatting(htmlBody.value));

function tidy() {
  if (!tidyable.value) return;
  htmlBody.value = formatHtml(htmlBody.value);
}

/**
 * Generating the plain-text part, and asking first only where there is something to lose.
 *
 * An empty part, or one that is already what the HTML strips to, is replaced with no
 * question at all. Asking every time is what teaches a reader to click through the one
 * time it mattered.
 */
const plainTextDialog = ref(false);
const generatedText = computed(() => toPlainText(htmlBody.value));

function generateText() {
  if (textBody.value.trim() === "" || textBody.value === generatedText.value) {
    textBody.value = generatedText.value;
    return;
  }
  plainTextDialog.value = true;
}

function confirmGenerateText() {
  textBody.value = generatedText.value;
  plainTextDialog.value = false;
  bodyTab.value = "text";
}

/*
 * Leaving with unpublished copy asks first, on both the routes the panel owns and the tab
 * the browser does. The browser's own prompt is all a reload or a close can have.
 */
useEventListener(window, "beforeunload", (event: BeforeUnloadEvent) => {
  if (dirty.value) event.preventDefault();
});

const leaveDialog = ref(false);
const leavingTo = ref<string | null>(null);

onBeforeRouteLeave((to) => {
  if (!dirty.value || leavingTo.value !== null) return true;
  leavingTo.value = to.fullPath;
  leaveDialog.value = true;
  return false;
});

function leaveNow() {
  const target = leavingTo.value;
  if (target !== null) void router.push(target);
}

function discardAndLeave() {
  discardAll();
  leaveNow();
}

async function publishAndLeave() {
  if (!(await publish())) return;
  leaveDialog.value = false;
  leaveNow();
}

watch(leaveDialog, (open) => {
  if (!open && leavingTo.value !== null && dirty.value) leavingTo.value = null;
});

/* A workspace belongs to the project it was opened from. Switching project leaves the
   drafts where they are, keyed by that project, and returns to the catalogue. */
watch(
  () => projects.current.id,
  () => {
    leavingTo.value = "/email/templates";
    void router.push("/email/templates");
  },
);

const publishedAgo = computed(() => {
  const row = stored.value;
  if (row === null) return "";
  const stamp = new Date(row.updatedAt);
  return relativeTimeWords(row.updatedAt, now.value < stamp ? stamp : now.value);
});

const toast = ref("");
const toastOpen = ref(false);

function notify(text: string) {
  toast.value = text;
  toastOpen.value = true;
}

const chain = computed(() => localeChain(locale.value));
</script>

<template>
  <div v-if="entry === undefined" class="flex flex-col gap-6">
    <PageHeader title="Unknown message" />
    <v-card border flat>
      <EmptyState
        description="That message is not one this deployment sends. It may have been renamed, or the link may be from a newer version of the panel."
        icon="material-symbols:mail-outline"
        title="No such message"
      >
        <template #actions>
          <v-btn
            class="text-xs font-medium"
            color="neutral"
            size="small"
            to="/email/templates"
            variant="text"
          >
            Back to templates
          </v-btn>
        </template>
      </EmptyState>
    </v-card>
  </div>

  <div v-else class="flex flex-col gap-4">
    <!--
      The workspace toolbar. It bleeds to the content column's edges and sticks under the
      app bar, so the way back, the state of the draft and the way to publish stay put
      however far the editor is scrolled. Below the desktop breakpoint it carries the panes
      instead and the actions move to the row at the foot.
    -->
    <div
      class="sticky top-14 z-10 -mx-6 -mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-canvas/85 px-6 py-2.5 backdrop-blur"
    >
      <div class="flex min-w-0 items-center gap-3">
        <NuxtLink
          class="flex flex-none items-center gap-1 rounded-(--idenzy-radius-x-small) text-xs font-medium text-ink/60 no-underline transition-colors duration-150 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          to="/email/templates"
        >
          <Icon
            aria-hidden="true"
            class="text-base"
            name="material-symbols:arrow-back"
          />
          Templates
        </NuxtLink>

        <span aria-hidden="true" class="h-4 w-px flex-none bg-line" />

        <div class="flex min-w-0 items-center gap-2">
          <Icon
            :name="entry.icon"
            aria-hidden="true"
            class="flex-none text-base text-ink/45"
          />
          <h1 class="m-0 truncate text-sm font-medium text-ink">{{ entry.label }}</h1>
          <span
            class="inline-flex flex-none rounded-full border border-line px-1.5 font-mono text-[10px] leading-4 text-ink/60"
          >
            {{ locale }}
          </span>
        </div>
      </div>

      <div class="flex flex-none items-center gap-3">
        <!-- Draft, compiling, sending: the three states, and never two of them at once. -->
        <p class="m-0 hidden min-w-0 items-center gap-2 text-xs sm:flex" role="status">
          <template v-if="saving">
            <Icon
              aria-hidden="true"
              class="flex-none animate-spin text-sm text-ink/55"
              name="material-symbols:progress-activity"
            />
            <span class="truncate text-ink/70">Publishing</span>
          </template>
          <template v-else-if="store.loading">
            <span aria-hidden="true" class="size-1.5 flex-none rounded-full bg-ink/25" />
            <span class="truncate text-ink/55">Reading the template</span>
          </template>
          <template v-else-if="dirty">
            <span aria-hidden="true" class="size-1.5 flex-none rounded-full bg-warning" />
            <span class="truncate font-medium text-ink">
              {{
                dirtyLocales.length === 1
                  ? `${dirtyLocales[0]} unpublished`
                  : `${dirtyLocales.length} languages unpublished`
              }}
            </span>
          </template>
          <template v-else-if="stored && !stored.compiled">
            <span aria-hidden="true" class="size-1.5 flex-none rounded-full bg-warning" />
            <span class="truncate text-ink/70">Compiling · built-in still sends</span>
          </template>
          <template v-else-if="stored">
            <span aria-hidden="true" class="size-1.5 flex-none rounded-full bg-success" />
            <v-tooltip :text="formatDateTime(stored.updatedAt)" location="bottom">
              <template #activator="{ props: tip }">
                <span v-bind="tip" class="truncate text-ink/70">
                  Sending · published {{ publishedAgo }}
                </span>
              </template>
            </v-tooltip>
          </template>
          <template v-else>
            <span aria-hidden="true" class="size-1.5 flex-none rounded-full bg-ink/25" />
            <span class="truncate text-ink/55">Our built-in copy</span>
          </template>
        </p>

        <SegmentedControl
          v-model="pane"
          :options="PANE_OPTIONS"
          class="xl:hidden"
          label="Pane"
        />

        <div class="hidden items-center gap-2 xl:flex">
          <v-btn
            v-if="dirty"
            :disabled="saving"
            class="text-xs font-medium"
            color="neutral"
            size="small"
            variant="text"
            @click="discardAll"
          >
            Discard
          </v-btn>
          <v-btn
            v-if="stored"
            :disabled="saving"
            class="text-xs font-medium"
            color="neutral"
            size="small"
            variant="text"
            @click="revertDialog = true"
          >
            Revert {{ locale }}
          </v-btn>
          <v-btn
            :disabled="!canPublish"
            class="text-xs font-medium"
            color="neutral"
            size="small"
            variant="text"
            @click="publish"
          >
            <template #prepend>
              <Icon
                :class="saving ? 'animate-spin' : ''"
                :name="
                  saving ? 'material-symbols:progress-activity' : 'material-symbols:publish-outline'
                "
                aria-hidden="true"
                class="text-sm"
              />
            </template>
            {{ publishLabel }}
          </v-btn>
        </div>
      </div>
    </div>

    <!--
      A problem in a language that is not on screen. The one on screen is marked under its
      own field, where the characters are; this strip exists because publishing writes every
      unsaved language and a reader would otherwise be refused with no way to see why.
    -->
    <div
      v-if="elsewhere.length > 0"
      class="flex flex-wrap items-center justify-between gap-3 rounded-(--idenzy-radius) border border-error/40 bg-error/6 px-4 py-3"
    >
      <p class="m-0 flex min-w-0 items-start gap-2 text-xs leading-5 text-ink">
        <Icon
          aria-hidden="true"
          class="mt-0.5 flex-none text-sm text-error"
          name="material-symbols:error-outline"
        />
        <span>
          Unpublished copy in
          <span class="font-mono">{{ elsewhere.map((held) => held.locale).join(", ") }}</span>
          would be refused by the server, so nothing can be published until it is settled.
        </span>
      </p>
      <v-btn
        class="flex-none text-xs font-medium"
        color="neutral"
        size="small"
        variant="text"
        @click="locale = elsewhere[0]?.locale ?? locale"
      >
        Open {{ elsewhere[0]?.locale }}
      </v-btn>
    </div>

    <p
      v-if="!entry.live"
      class="m-0 flex items-start gap-2 rounded-(--idenzy-radius) bg-ink/4 ring-1 ring-ink/6 ring-inset px-4 py-3 text-xs leading-5 text-ink/70"
    >
      <Icon
        aria-hidden="true"
        class="mt-0.5 flex-none text-sm text-warning"
        name="material-symbols:schedule-outline"
      />
      <span>
        <span class="font-medium text-ink">Nothing sends this message yet.</span>
        Copy written now is stored against the project and waits for the flow behind it.
        Worth knowing before translating it into nine languages.
      </span>
    </p>

    <!--
      The workspace proper. On a desktop it is given a definite height and each pane scrolls
      inside itself, which is what an editor wants: the toolbar, the language list and the
      preview stay where they are however long the body gets. Below the breakpoint the panes
      are tabs and each takes the height it needs.
    -->
    <div
      class="grid items-stretch gap-4 xl:h-[calc(100dvh-13.5rem)] xl:min-h-[34rem] xl:grid-cols-12"
    >
      <!-- The languages. Two columns of twelve, because it is a list of two-letter tags. -->
      <aside
        :class="pane === 'editor' ? '' : 'hidden xl:flex'"
        class="flex min-h-0 min-w-0 flex-col gap-3 xl:col-span-2 xl:overflow-y-auto"
      >
        <v-card border class="flex-none overflow-hidden" flat>
          <h2
            class="m-0 border-b border-line px-3 py-2 text-xs font-medium text-ink"
          >
            Languages
          </h2>
          <EmailLanguageList
            :current="locale"
            :disabled="saving"
            :entries="languages"
            :sources="seedSources"
            @add="addLanguage"
            @select="locale = $event"
          />
        </v-card>

        <p class="m-0 px-1 text-[11px] leading-4 text-ink/50">
          A reader in <span class="font-mono text-ink/70">{{ locale }}</span> is answered
          with <span class="font-mono text-ink/70">{{ chain.join(" → ") }}</span>, your copy
          at every step before ours.
        </p>
      </aside>

      <!-- The three bodies. -->
      <section
        :class="pane === 'editor' ? '' : 'hidden xl:flex'"
        class="flex min-h-0 min-w-0 flex-col xl:col-span-5"
      >
        <v-card border class="flex min-h-0 flex-1 flex-col overflow-hidden" flat>
          <div class="flex flex-none items-center justify-between gap-3 border-b border-line px-3 py-1.5">
            <h2 class="m-0 text-xs font-medium text-ink">Content</h2>
            <TemplateVariableMenu
              :disabled="saving"
              :variables="scope"
              @insert="insertVariable"
            />
          </div>

          <div class="flex min-h-0 flex-1 flex-col">
            <div class="flex flex-none flex-col gap-1.5 p-3">
              <label class="text-xs font-medium text-ink" for="template-subject">Subject</label>
              <CodeEditor
                id="template-subject"
                ref="subjectEditor"
                v-model="subject"
                :invalid="issues.subject.length > 0"
                :readonly="saving"
                :variables="scope"
                inline
                label="Subject"
                placeholder="What the reader sees in their inbox"
                @focus="focusedField = 'subject'"
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

            <!--
              The two bodies as tabs rather than stacked, which is what stops the field
              being edited from sitting below the fold. The tidy and the generate sit on
              this row because each belongs to one of the two and only one is on screen.
            -->
            <div
              class="flex flex-none flex-wrap items-center justify-between gap-2 border-y border-line bg-ink/3 px-3 py-2"
            >
              <SegmentedControl v-model="bodyTab" :options="BODY_TABS" label="Body" />

              <div class="flex items-center gap-1">
                <template v-if="bodyTab === 'html'">
                  <v-tooltip
                    :text="
                      tidyable
                        ? 'Tidy the markup: indentation and line breaks, nothing else'
                        : 'Already tidy'
                    "
                    location="top"
                  >
                    <template #activator="{ props: tip }">
                      <span v-bind="tip">
                        <v-btn
                          :disabled="!tidyable || saving"
                          aria-label="Tidy the markup"
                          class="template__glyph"
                          color="neutral"
                          icon
                          size="x-small"
                          variant="text"
                          @click="tidy"
                        >
                          <Icon
                            aria-hidden="true"
                            class="text-base"
                            name="material-symbols:format-indent-increase"
                          />
                        </v-btn>
                      </span>
                    </template>
                  </v-tooltip>
                </template>
                <v-btn
                  v-else
                  :disabled="saving"
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
            </div>

            <div class="flex min-h-[24rem] flex-1 flex-col p-3 xl:min-h-0">
              <CodeEditor
                v-show="bodyTab === 'html'"
                ref="bodyEditor"
                v-model="htmlBody"
                :invalid="issues.html.length > 0"
                :readonly="saving"
                :variables="scope"
                class="flex-1"
                label="HTML body"
                language="html"
                @focus="focusedField = 'body'"
              />
              <CodeEditor
                v-show="bodyTab === 'text'"
                v-model="textBody"
                :invalid="issues.text.length > 0"
                :readonly="saving"
                :variables="scope"
                class="flex-1"
                label="Plain-text body"
                placeholder="What a text client and a screen reader are given"
                @focus="focusedField = 'body'"
              />
            </div>

            <div
              v-if="issues.html.length > 0 || issues.text.length > 0 || bodyTab === 'text'"
              class="flex flex-none flex-col gap-1.5 border-t border-line px-3 py-2.5"
            >
              <p
                v-for="issue in bodyTab === 'html' ? issues.html : issues.text"
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
              <p v-if="bodyTab === 'text'" class="m-0 text-[11px] leading-4 text-ink/50">
                Written rather than generated, because this is what a screen reader and a
                spam filter read, and a mechanical strip of the HTML reads like one.
              </p>
            </div>
          </div>
        </v-card>
      </section>

      <!-- What a reader receives. -->
      <section
        :class="pane === 'preview' ? '' : 'hidden xl:flex'"
        class="flex min-h-0 min-w-0 flex-col gap-2 xl:col-span-5"
      >
        <v-card border class="flex min-h-0 flex-1 flex-col overflow-hidden" flat>
          <div class="flex flex-none items-center justify-between gap-3 border-b border-line px-3 py-1.5">
            <h2 class="m-0 text-xs font-medium text-ink">Preview</h2>
            <div class="flex items-center gap-2">
              <!-- Present and switched off, with the reason, rather than absent: a
                   workspace that silently lacks the obvious action reads as a missing
                   feature nobody explained. -->
              <v-tooltip
                location="top"
                text="Not available. No audited send exists behind this yet, so the panel will not offer one it cannot prove happened."
              >
                <template #activator="{ props: tip }">
                  <span v-bind="tip">
                    <v-btn
                      class="text-xs font-medium"
                      color="neutral"
                      disabled
                      prepend-icon="material-symbols:send-outline"
                      size="small"
                      variant="text"
                    >
                      Send a test
                    </v-btn>
                  </span>
                </template>
              </v-tooltip>
              <SegmentedControl
                v-if="bodyTab === 'html'"
                v-model="viewport"
                :options="VIEWPORTS"
                label="Preview width"
              />
            </div>
          </div>

          <EmailPreviewFrame
            :body="bodyTab === 'html' ? renderedHtml : renderedText"
            :from="sender"
            :locale="locale"
            :mode="bodyTab"
            :source="stored ? 'yours' : 'built_in'"
            :subject="renderedSubject"
            :viewport="viewport"
            class="min-h-[26rem] flex-1 xl:min-h-0"
          />
        </v-card>

        <p class="m-0 flex-none px-1 text-[11px] leading-4 text-ink/50">
          Sample values, substituted as the renderer would: escaped in the HTML, literal in
          the subject and the text part. A placeholder with nothing to put there is left
          standing, which is the honest preview of a body the server would refuse.
        </p>
      </section>
    </div>

    <!--
      The action row below the breakpoint, where the toolbar has given its right-hand side
      to the panes. Sticky rather than fixed, so it reserves its own space and never sits
      over the last field.
    -->
    <div
      class="sticky bottom-0 z-10 flex items-center justify-between gap-3 rounded-(--idenzy-radius) border border-line bg-surface/95 px-3 py-2.5 shadow-lg backdrop-blur xl:hidden"
    >
      <span class="min-w-0 truncate px-1 text-xs text-ink/50">
        {{
          blockedReason ||
          (dirty ? "Ready to publish" : stored ? "Your copy is sending" : "Our built-in copy")
        }}
      </span>
      <span class="flex flex-none items-center gap-2">
        <v-btn
          v-if="dirty && !saving"
          class="text-xs font-medium"
          color="neutral"
          size="small"
          variant="text"
          @click="discardLocale"
        >
          Discard
        </v-btn>
        <v-btn
          :disabled="!canPublish"
          class="text-xs font-medium"
          color="neutral"
          size="small"
          variant="text"
          @click="publish"
        >
          <template #prepend>
            <Icon
              :class="saving ? 'animate-spin' : ''"
              :name="
                saving ? 'material-symbols:progress-activity' : 'material-symbols:publish-outline'
              "
              aria-hidden="true"
              class="text-sm"
            />
          </template>
          {{ publishLabel }}
        </v-btn>
      </span>
    </div>

    <EmailRevertDialog
      v-model="revertDialog"
      :busy="saving"
      :fallback-locale="fallback.locale"
      :fallback-source="fallback.source"
      :fallback-subject="fallback.subject"
      :has-draft="store.isDirty(projects.current.id, type, locale)"
      :locale="locale"
      :message="entry.label"
      @confirm="confirmRevert"
    />

    <EmailPlainTextDialog
      v-model="plainTextDialog"
      :current="textBody"
      :generated="generatedText"
      @confirm="confirmGenerateText"
    />

    <UnsavedChangesDialog
      v-model="leaveDialog"
      :blocked-reason="blockedReason"
      :busy="saving"
      :changes="dirtyLocales.length"
      :publishable="canPublish"
      description="Unpublished copy is held while the panel is open and lost on a reload. Readers keep receiving the copy that is sending until this replaces it."
      noun="language"
      @discard="discardAndLeave"
      @publish="publishAndLeave"
    />

    <v-snackbar
      v-model="toastOpen"
      :timeout="3000"
      color="surface"
      location="bottom right"
      rounded="lg"
      variant="flat"
    >
      <span class="text-xs text-ink">{{ toast }}</span>
    </v-snackbar>
  </div>
</template>

<style scoped>
/* The tidy glyph sits in a row of small controls and takes their height. */
.template__glyph {
  height: 28px;
  width: 28px;
}
</style>

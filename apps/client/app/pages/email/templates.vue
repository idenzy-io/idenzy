<script setup lang="ts">
/**
 * Email templates: the transactional mail a project sends, and which of it the project
 * has written itself (PROJECT.md 11.3, `packages/templating`).
 *
 * The table is the catalogue rather than a list of stored rows, and that is the decision
 * the screen hangs off. A project that has customised nothing still sends a complete set
 * of mail, so a list of what is stored would be empty on a working project and would tell
 * an operator nothing about what their users receive. Every type is a row, and the row
 * says which copy a send would actually use.
 *
 * Which copy that is depends on the reader's language, so the reader's language is a
 * control. The renderer tries the project's whole fallback chain before any built-in of
 * ours, and moving that control shows it happening across every row at once: a project
 * with Turkish for one message and nothing for the rest sends their Turkish for that one
 * and their English, not our Turkish, for the others. That rule is easy to state and hard
 * to picture, which is why it is wired to a control instead of written in a paragraph.
 *
 * Four types in the protocol have no flow behind them yet. They are rows too, marked, and
 * the editor says that copy written now is stored and not sent, because finding that out
 * after translating into nine languages is worse than reading it here.
 */
import type { ColumnState, DataTableColumn, DataTableSort } from "~/utils/data-table";
import { defaultColumnState, reconcileColumnState } from "~/utils/data-table";
import {
  BUILT_IN,
  catalogueEntry,
  DEFAULT_LOCALE,
  type EmailTemplateType,
  localeChain,
  resolve,
  TEMPLATE_CATALOGUE,
  type TemplateBodies,
  type TemplateCatalogueEntry,
} from "~/utils/email-templates";
import { CODE, humanizeSeconds } from "~/utils/otp";
import { formatDateTime, relativeTime } from "~/utils/time";

const projects = useProjectStore();
const store = useEmailTemplatesStore();

const now = useNow({ interval: 30_000 });

/* Which cards start unfolded. The table is what a visit is for. */
const expanded = reactive({ language: false, rules: false });

/**
 * The language a preview is resolved for. Not a project setting: it is whatever the
 * caller's `Accept-Language` said on the request that triggered the mail, so this control
 * asks a question rather than changing anything.
 */
const reader = ref(DEFAULT_LOCALE);

const readerOptions = computed(() => {
  const held = new Set([
    DEFAULT_LOCALE,
    ...store.forProject(projects.current.id).map((r) => r.locale),
  ]);
  return [...held].sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: value }));
});

/* A language that was on the list and is not any more must not leave the control unset. */
watch([readerOptions, () => projects.current.id], ([options]) => {
  if (!options.some((option) => option.value === reader.value)) reader.value = DEFAULT_LOCALE;
});

/*
 * One row per template type, with the resolution worked out for the reader on the
 * control. `source` is the answer to the only question the table exists to answer: whose
 * words does somebody actually receive.
 */
interface TemplateRow {
  type: EmailTemplateType;
  entry: TemplateCatalogueEntry;
  label: string;
  source: "yours" | "built_in";
  /** The locale that supplied the copy, which is rarely the one asked for. */
  from: string;
  locales: string[];
  subject: string;
  version: number | null;
  updatedAt: string | null;
  compiled: boolean;
}

const rows = computed<TemplateRow[]>(() =>
  TEMPLATE_CATALOGUE.map((entry) => {
    const locales = store.localesFor(projects.current.id, entry.type);
    /* A row still compiling is not yet what a send would read, so it does not count as
       stored here: the resolution has to answer with the copy that would actually go. */
    const sending = locales.filter(
      (locale) => store.find(projects.current.id, entry.type, locale)?.compiled === true,
    );
    const resolution = resolve(reader.value, sending);
    const stored =
      resolution.source === "yours"
        ? store.find(projects.current.id, entry.type, resolution.locale)
        : null;
    const latest = locales
      .map((locale) => store.find(projects.current.id, entry.type, locale))
      .filter((row) => row !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

    return {
      type: entry.type,
      entry,
      label: entry.label,
      source: resolution.source,
      from: resolution.locale,
      locales,
      subject: stored?.subject ?? BUILT_IN[entry.type]?.subject ?? "",
      version: stored?.version ?? null,
      updatedAt: latest?.updatedAt ?? null,
      compiled: locales.every(
        (locale) => store.find(projects.current.id, entry.type, locale)?.compiled !== false,
      ),
    };
  }),
);

/* The tabs, in the order somebody asks the questions: everything, then what I changed,
   then what I have not, then the ones nothing sends. */
const filterTab = ref("all");

const counts = computed(() => ({
  all: rows.value.length,
  yours: rows.value.filter((row) => row.locales.length > 0).length,
  built_in: rows.value.filter((row) => row.locales.length === 0 && row.entry.live).length,
  unsent: rows.value.filter((row) => !row.entry.live).length,
}));

const filterOptions = computed(() => [
  { value: "all", label: `All · ${counts.value.all}` },
  { value: "yours", label: `Yours · ${counts.value.yours}` },
  { value: "built_in", label: `Built-in · ${counts.value.built_in}` },
  { value: "unsent", label: `Not sent · ${counts.value.unsent}` },
]);

const query = ref("");

const listed = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return rows.value.filter((row) => {
    const inTab =
      filterTab.value === "all" ||
      (filterTab.value === "yours" && row.locales.length > 0) ||
      (filterTab.value === "built_in" && row.locales.length === 0 && row.entry.live) ||
      (filterTab.value === "unsent" && !row.entry.live);
    const matches =
      needle === "" ||
      row.label.toLowerCase().includes(needle) ||
      row.type.includes(needle) ||
      row.subject.toLowerCase().includes(needle);
    return inTab && matches;
  });
});

const COLUMNS: readonly DataTableColumn<TemplateRow>[] = [
  { key: "label", title: "Message", fixed: true, minWidth: 210 },
  {
    key: "source",
    title: "Copy in use",
    width: 150,
    skeleton: "pill",
    value: (row) => (row.source === "yours" ? 0 : 1),
  },
  {
    key: "locales",
    title: "Languages",
    width: 150,
    skeleton: "glyphs",
    value: (row) => row.locales.length,
  },
  { key: "subject", title: "Subject", minWidth: 260, value: (row) => row.subject.toLowerCase() },
  {
    key: "trigger",
    title: "Sent when",
    width: 210,
    hidden: true,
    value: (row) => row.entry.trigger,
  },
  {
    key: "updatedAt",
    title: "Changed",
    width: 120,
    mono: true,
    value: (row) => row.updatedAt ?? "",
  },
];

const stored = useLocalStorage<ColumnState>(
  "idenzy.email-templates.columns",
  defaultColumnState(COLUMNS),
);
const columnState = computed<ColumnState>({
  get: () => reconcileColumnState(COLUMNS, stored.value),
  set: (value) => {
    stored.value = value;
  },
});
const sortBy = ref<DataTableSort[]>([]);
const page = ref(1);
const pageSize = useLocalStorage("idenzy.email-templates.page-size", 25);

watch([query, filterTab, () => projects.current.id], () => {
  page.value = 1;
});

/*
 * Editing. The dialog owns the language, so the page only says which message to open and
 * which language to open it on: the one whose copy a send would use for the reader above.
 */
const editing = ref<TemplateRow | null>(null);
const editorOpen = ref(false);
const saving = ref(false);

function edit(row: TemplateRow) {
  editing.value = row;
  editorOpen.value = true;
}

const editorLocale = computed(() => {
  const row = editing.value;
  if (row === null) return DEFAULT_LOCALE;
  return row.source === "yours" ? row.from : (localeChain(reader.value)[0] ?? DEFAULT_LOCALE);
});

const editorLocales = computed(() => editing.value?.locales ?? []);

function findStored(type: EmailTemplateType, locale: string) {
  return store.find(projects.current.id, type, locale);
}

async function whileSaving(work: () => Promise<void>) {
  saving.value = true;
  try {
    await work();
  } finally {
    saving.value = false;
  }
}

function onSave(locale: string, draft: TemplateBodies) {
  const row = editing.value;
  if (row === null) return;
  void whileSaving(async () => {
    await store.save(projects.current.id, row.type, locale, draft, "hasan@example.com");
    notify(`${row.label} saved for ${locale}`);
  });
}

function onRevert(locale: string) {
  const row = editing.value;
  if (row === null) return;
  void whileSaving(async () => {
    await store.revert(projects.current.id, row.type, locale);
    notify(`${row.label} is back to the built-in for ${locale}`);
  });
}

/* A dialog belongs to the project it was opened from. */
watch(
  () => projects.current.id,
  () => {
    editorOpen.value = false;
    editing.value = null;
  },
);

const toast = ref("");
const toastOpen = ref(false);

function notify(text: string) {
  toast.value = text;
  toastOpen.value = true;
}

/**
 * What the preview writes into `expires_in`. The mailer works it out from the lifetime of
 * whatever the mail carries, so it is the deployment's number rather than a field here,
 * and it is read from the one-time-code screen's own constants so the two agree.
 */
const expiresInSeconds = CODE.lifetimeSeconds;
const expiresInLabel = humanizeSeconds(expiresInSeconds);

/* What the reader's language actually resolves to, spelled out under the control. */
const chain = computed(() => localeChain(reader.value));

const customised = computed(() => store.forProject(projects.current.id).length);
const compiling = computed(
  () => store.forProject(projects.current.id).filter((row) => !row.compiled).length,
);
const languages = computed(
  () => new Set(store.forProject(projects.current.id).map((row) => row.locale)).size,
);
const customisedMessages = computed(() => counts.value.yours);

const GUIDES = [
  {
    icon: "material-symbols:mail-outline",
    title: "Template studio",
    detail: "The types, the variables each carries, and how a locale resolves.",
    href: "https://idenzy.dev/docs/email/templates",
  },
  {
    icon: "material-symbols:code",
    title: "The template language",
    detail: "Substitution only, why there are no conditionals, and what escaping covers.",
    href: "https://idenzy.dev/docs/email/language",
  },
  {
    icon: "material-symbols:translate",
    title: "Languages and fallback",
    detail: "The chain, and why your English beats our Turkish.",
    href: "https://idenzy.dev/docs/email/locales",
  },
  {
    icon: "material-symbols:terminal",
    title: "idenzy templates pull/push",
    detail: "Keeping copy in your own repository and shipping it with a release.",
    href: "https://idenzy.dev/docs/cli/templates",
  },
];
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:mail-outline" title="Email templates">
      <template #description>
        The transactional mail
        <span class="font-medium text-ink">{{ projects.current.name }}</span> sends. Every
        message has copy behind it from the start, so this is a catalogue rather than a
        list of what you have written, and each row says whose words a reader actually
        gets.
      </template>
    </PageHeader>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <div class="flex min-w-0 flex-col gap-6">
        <LayerCard :padded="false" title="Messages">
          <template #badge>
            <StatusBadge
              :label="customised === 0 ? 'All built-in' : `${customised} customised`"
              tone="neutral"
            />
          </template>
          <template #actions>
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-ink/55">Reader's language</span>
              <SegmentedControl
                v-model="reader"
                :options="readerOptions"
                label="Reader's language"
              />
            </div>
          </template>

          <div
            class="flex flex-col gap-3 border-b border-line p-3 lg:flex-row lg:items-center lg:justify-between"
          >
            <SegmentedControl v-model="filterTab" :options="filterOptions" label="Templates" />

            <div class="flex flex-wrap items-center gap-2">
              <v-text-field
                v-model="query"
                aria-label="Search templates"
                class="templates__search w-full sm:w-64"
                clearable
                density="comfortable"
                hide-details
                placeholder="Search a message or subject"
                prepend-inner-icon="material-symbols:search"
                variant="outlined"
              />
              <DataTableColumnsMenu v-model="columnState" :columns="COLUMNS" />
            </div>
          </div>

          <DataTable
            v-model:column-state="columnState"
            v-model:items-per-page="pageSize"
            v-model:page="page"
            v-model:sort-by="sortBy"
            :columns="COLUMNS"
            :items="listed"
            :loading="store.loading"
            empty-description="Try another search, or clear the filter to see every message."
            empty-title="No message matches"
            item-value="type"
            label="Email templates"
          >
            <template #cell.label="{ item }">
              <span class="flex min-w-0 items-center gap-2.5">
                <Icon
                  :name="item.entry.icon"
                  aria-hidden="true"
                  class="flex-none text-base text-ink/45"
                />
                <span class="flex min-w-0 flex-col">
                  <span class="truncate text-xs font-medium text-ink">{{ item.label }}</span>
                  <span class="truncate font-mono text-[10px] leading-4 text-ink/45">
                    {{ item.type }}
                  </span>
                </span>
              </span>
            </template>

            <!-- The one column the table exists for: whose words go out, and from which
                 language after the chain resolved. -->
            <template #cell.source="{ item }">
              <span class="flex items-center gap-1.5">
                <StatusBadge
                  :detail="item.from"
                  :label="item.source === 'yours' ? 'Yours' : 'Built-in'"
                  :tone="item.source === 'yours' ? 'success' : 'neutral'"
                />
              </span>
            </template>

            <template #cell.locales="{ item }">
              <span v-if="item.locales.length === 0" class="text-xs text-ink/45">—</span>
              <span v-else class="flex flex-wrap items-center gap-1">
                <v-tooltip
                  v-for="locale in item.locales"
                  :key="locale"
                  :text="
                    store.find(projects.current.id, item.type, locale)?.compiled === false
                      ? `${locale} is saved and still compiling, so the built-in is what sends`
                      : `${locale} is stored and sending`
                  "
                  location="top"
                >
                  <template #activator="{ props: tip }">
                    <span
                      v-bind="tip"
                      :class="
                        store.find(projects.current.id, item.type, locale)?.compiled === false
                          ? 'border-warning/50 text-warning'
                          : 'border-line text-ink/70'
                      "
                      class="inline-flex rounded-full border px-1.5 font-mono text-[10px] leading-4"
                    >
                      {{ locale }}
                    </span>
                  </template>
                </v-tooltip>
              </span>
            </template>

            <template #cell.subject="{ item }">
              <span class="truncate font-mono text-[11px] text-ink/75">{{ item.subject }}</span>
            </template>

            <template #cell.trigger="{ item }">
              <span class="truncate text-xs text-ink/70">{{ item.entry.trigger }}</span>
              <StatusBadge v-if="!item.entry.live" class="ml-1.5" label="Not built" tone="warning" />
            </template>

            <template #cell.updatedAt="{ item }">
              <v-tooltip
                v-if="item.updatedAt"
                :text="formatDateTime(item.updatedAt)"
                location="top"
              >
                <template #activator="{ props: tip }">
                  <span v-bind="tip" class="font-mono text-[11px] text-ink/70 tabular-nums">
                    {{ relativeTime(item.updatedAt, now) }}
                  </span>
                </template>
              </v-tooltip>
              <span v-else class="text-xs text-ink/45">Never</span>
            </template>

            <template #actions="{ item }">
              <v-btn
                class="text-xs font-medium"
                color="neutral"
                size="small"
                variant="text"
                @click="edit(item)"
              >
                {{ item.locales.length > 0 ? "Edit" : "Customise" }}
              </v-btn>
            </template>
          </DataTable>

          <div
            class="grid gap-4 border-t border-line bg-canvas/60 px-4 py-3.5 text-[11px] leading-4 sm:grid-cols-2"
          >
            <p class="m-0 text-ink/60">
              <!-- The two spans share a line on purpose: Vue's condense mode drops a
                   whitespace-only text node that contains a newline, so a line break here
                   would run "with" into the chain. -->
              <span class="font-medium text-ink">A reader in {{ reader }} is answered with</span> <span class="font-mono text-ink/80">{{ chain.join(" → ") }}</span>, your copy at
              every step before ours. Our built-ins are English only today, so the last step is
              always <span class="font-mono text-ink/80">en</span>.
            </p>
            <p class="m-0 text-ink/60">
              <span class="font-medium text-ink">
                <span class="font-mono text-ink/80">expires_in</span> arrives written out.
              </span>
              The flow works it out from the lifetime of whatever the mail carries and rounds it,
              so a reader never sees a count of seconds. The preview uses a
              <NuxtLink
                class="font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
                to="/methods/otp"
                >one-time code</NuxtLink
              >, which is {{ expiresInLabel }}.
            </p>
          </div>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.language"
          description="Substitution and nothing else, which is a security property rather than a missing feature."
          expandable
          title="The template language"
        >
          <div class="divide-y divide-line">
            <SettingRow label="What a body may contain">
              <template #description>
                <span v-pre class="font-mono text-ink/80">{{ name }}</span> and
                <span v-pre class="font-mono text-ink/80">{{ name.path }}</span
                >. No conditionals, no loops, no helpers, no expressions. A template is your
                content rendered on our servers with our data in scope, so anything that
                can evaluate is a sandbox escape waiting to be found. Anything else in
                braces is not a placeholder and is sent to the reader as typed.
              </template>
              <template #actions>
                <span
                  class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55"
                >
                  Substitution
                </span>
              </template>
            </SettingRow>
            <SettingRow
              description="A name that is not in scope for the message fails the send rather than rendering an empty string. A sign-in mail with no code in it is worse than one that never arrived: the first is found by a user who cannot get in, the second by us. The editor refuses the save for the same reason."
              fixed="Fails closed"
              label="A variable that is not in scope"
            />
            <SettingRow
              description="Every substituted value is HTML-escaped in the HTML body, so a display name containing a tag is text and not markup. The subject and the plain-text part are substituted literally, because there is no markup there to escape into."
              fixed="Always"
              label="Escaping"
            />
            <SettingRow label="Links">
              <template #description>
                <span class="font-mono text-ink/80">link</span> and anything ending
                <span class="font-mono text-ink/80">_url</span> must be an absolute http or
                https URL, and a value carrying an executable scheme is refused before
                escaping is considered. Escaping does not help in an
                <span class="font-mono text-ink/80">href</span>: a correctly quoted
                attribute whose whole value is a script URL is still a script. The link
                itself is signed and pinned to a registered redirect target before it
                reaches the template, so a body cannot make an open redirect out of it.
              </template>
              <template #actions>
                <span
                  class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55"
                >
                  http or https
                </span>
              </template>
            </SettingRow>
            <SettingRow
              description="Attachments are not available and will not be. A transactional auth mail has nothing to attach, and an attachment is the part of an email that gets a domain's reputation destroyed."
              fixed="Never"
              label="Attachments"
            />
          </div>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.rules"
          description="What happens between saving a template and a reader receiving it."
          expandable
          title="Saving and sending"
        >
          <div class="divide-y divide-line">
            <SettingRow
              description="A saved body is compiled off the request path, on the worker pool, and the result is cached by version. Until that has happened the row reads as absent and the built-in is what goes out, which is deliberate: a row that has not compiled is not something to send, and an empty mail would be worse than ours. The list marks a language that is still in that window."
              fixed="Worker pool"
              label="Compiling"
            />
            <SettingRow
              description="A project's whole fallback chain is tried before any built-in of ours. A project that has translated English and not Turkish sends their English to a Turkish reader, because their copy carries their product's name and voice and ours carries neither."
              fixed="Yours first"
              label="Which copy wins"
            />
            <SettingRow
              description="One row per message and language, and a save writes all three bodies at once. They are one message: a subject stored against a body somebody else replaced is a mail nobody wrote."
              fixed="Whole"
              label="How a save is written"
            />
            <SettingRow
              description="Removing your copy for a language is reverting rather than deleting: the built-in is behind it and the message keeps sending. There is no state in which a project sends nothing because a template is missing."
              fixed="Reverts"
              label="Removing a template"
            />
            <SettingRow
              description="The sending address belongs to the deployment today, and a per-message from-name, reply-to and custom headers are named in the design and not built. A verified sending domain of your own is the change that makes them worth having."
              fixed="Not built"
              label="From, reply-to and headers"
            />
          </div>
        </LayerCard>
      </div>

      <aside class="flex flex-col gap-4 xl:sticky xl:top-20">
        <div class="flex items-baseline justify-between px-1">
          <h2 class="m-0 text-base font-semibold tracking-tight text-ink">Copy</h2>
          <span class="text-xs text-ink/55">On this project</span>
        </div>
        <LayerCard :padded="false" title="What this project has written">
          <div class="flex flex-col gap-2.5 p-4 text-xs">
            <div class="flex items-center justify-between gap-3">
              <span class="text-ink/60">Messages you have customised</span>
              <span class="font-mono text-[11px] text-ink tabular-nums">
                {{ customisedMessages }}<span class="text-ink/35">/{{ rows.length }}</span>
              </span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-ink/60">Stored templates</span>
              <span class="font-mono text-[11px] text-ink tabular-nums">{{ customised }}</span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-ink/60">Languages</span>
              <span class="font-mono text-[11px] text-ink tabular-nums">{{ languages }}</span>
            </div>
          </div>
        </LayerCard>

        <LayerCard
          v-if="compiling > 0"
          description="Saved and still on the worker pool. Until it lands, the built-in is what sends."
          title="Compiling"
        >
          <p class="m-0 flex items-center gap-2 text-xs text-ink/70">
            <Icon
              aria-hidden="true"
              class="flex-none animate-spin text-base text-warning"
              name="material-symbols:progress-activity"
            />
            {{ compiling === 1 ? "One template" : `${compiling} templates` }} waiting
          </p>
        </LayerCard>

        <LayerCard
          :padded="false"
          description="What every message carries, whatever the type. The rest differ, and the editor lists them per message."
          title="Always in scope"
        >
          <ul class="m-0 flex list-none flex-col divide-y divide-line p-0 text-xs">
            <li class="flex flex-col gap-0.5 px-4 py-2.5">
              <span class="font-mono text-[11px] text-ink">project.name</span>
              <span class="text-[11px] leading-4 text-ink/55">
                The project's name, read from the record rather than typed into the copy.
              </span>
            </li>
            <li class="flex flex-col gap-0.5 px-4 py-2.5">
              <span class="font-mono text-[11px] text-ink">user.email</span>
              <span class="text-[11px] leading-4 text-ink/55">
                The address the mail is going to, which is not always the account's own: on
                an address change one goes to each.
              </span>
            </li>
            <li class="flex flex-col gap-0.5 px-4 py-2.5">
              <span class="font-mono text-[11px] text-ink">expires_in</span>
              <span class="text-[11px] leading-4 text-ink/55">
                Already written out, and rounded: "{{ expiresInLabel }}", never a count of
                seconds a reader cannot act on.
              </span>
            </li>
          </ul>
        </LayerCard>

        <LayerCard :padded="false" title="Guides">
          <ul class="m-0 list-none divide-y divide-line p-0">
            <li v-for="guide in GUIDES" :key="guide.href">
              <a
                :href="guide.href"
                class="flex items-start gap-3 px-4 py-3 text-xs no-underline transition-colors duration-150 hover:bg-ink/3"
                rel="noopener"
                target="_blank"
              >
                <Icon
                  :name="guide.icon"
                  aria-hidden="true"
                  class="mt-px flex-none text-xl text-ink/70"
                />
                <span class="flex min-w-0 flex-col gap-0.5">
                  <span class="font-medium text-ink">{{ guide.title }}</span>
                  <span class="line-clamp-1 text-[11px] text-ink/55">{{ guide.detail }}</span>
                </span>
              </a>
            </li>
          </ul>
        </LayerCard>

        <SaveStatus :last-saved="store.lastSavedAt(projects.current.id)" :saving="saving" />
      </aside>
    </div>

    <EmailTemplateDialog
      v-if="editing"
      v-model="editorOpen"
      :expires-in-seconds="expiresInSeconds"
      :find="findStored"
      :initial-locale="editorLocale"
      :locales="editorLocales"
      :project-name="projects.current.name"
      :saving="saving"
      :type="editing.type"
      @revert="onRevert"
      @save="onSave"
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
/* A search box at the height of the control beside it, in the toolbar's small type and on
   the small radius, so the row reads as one set. */
.templates__search :deep(.v-field) {
  --v-input-control-height: 32px;

  border-radius: var(--idenzy-radius-small);
  font-size: 0.75rem;
}

.templates__search :deep(.v-field__input),
.templates__search :deep(.v-field__input::placeholder) {
  font-size: 0.75rem;
  min-height: 32px;
}

.templates__search :deep(.v-field__prepend-inner > .v-icon),
.templates__search :deep(.v-field__clearable > .v-icon) {
  font-size: 1rem;
}
</style>

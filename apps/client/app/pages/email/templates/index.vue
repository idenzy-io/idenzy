<script setup lang="ts">
/**
 * The message catalogue: every transactional mail a project can send, and which copy a
 * reader would actually receive (PROJECT.md 11.3, `notes/email-templates.md`).
 *
 * The table is the catalogue rather than a list of stored rows, and that is the decision
 * the screen hangs off. A project that has customised nothing still sends a complete set
 * of mail, so a list of what is stored would be empty on a working project and would tell
 * an operator nothing about what their users receive. Every type is a row, and the row
 * says which copy a send would use.
 *
 * Which copy that is depends on the reader's language, so the reader's language is a
 * control. The renderer tries the project's whole fallback chain before any built-in of
 * ours, and moving that control shows it happening across every row at once: a project
 * with Turkish for one message and nothing for the rest sends their Turkish for that one
 * and their English, not our Turkish, for the others. That rule is easy to state and hard
 * to picture, which is why it is wired to a control instead of written in a paragraph.
 *
 * **Saved and sending are different states and the table says which.** A body is compiled
 * off the request path, and until that has happened the renderer reads the row as absent
 * and our built-in is what goes out. A row through that window says Compiling, not
 * Custom: an operator who has just published new copy and is told it is theirs would have
 * no way to learn otherwise.
 *
 * **The subject column is rendered, not source.** `{{ otp }} is your {{ project.name }}
 * sign-in code` is a template, and what a reader sees in their inbox is `418 205 is your
 * Acme sign-in code`. The second is the thing being checked at a glance, so it is the one
 * on the row, with the source a hover away.
 *
 * Editing is a page and not a dialog (`/email/templates/:type`), because the workspace has
 * language management, three bodies, a preview and reversion in it and a modal is where
 * unsaved work goes to be lost.
 */
import type { ColumnState, DataTableColumn, DataTableSort } from "~/utils/data-table";
import { defaultColumnState, reconcileColumnState } from "~/utils/data-table";
import {
  BUILT_IN,
  DEFAULT_LOCALE,
  type EmailTemplateType,
  localeChain,
  renderPreview,
  resolve,
  sampleValues,
  statusOf,
  TEMPLATE_CATALOGUE,
  TEMPLATE_STATUS_LABELS,
  type TemplateCatalogueEntry,
  type TemplateStatus,
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
 * asks a question rather than changing anything. Named for what it does after the note's
 * finding that "Reader's language" was read as a setting somebody had chosen.
 */
const reader = ref(DEFAULT_LOCALE);

const readerOptions = computed(() => {
  const held = new Set([
    DEFAULT_LOCALE,
    ...store.forProject(projects.current.id).map((row) => row.locale),
  ]);
  return [...held].sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: value }));
});

/* A language that was on the list and is not any more must not leave the control unset. */
watch([readerOptions, () => projects.current.id], ([options]) => {
  if (!options.some((option) => option.value === reader.value)) reader.value = DEFAULT_LOCALE;
});

const expiresInSeconds = CODE.lifetimeSeconds;
const expiresInLabel = humanizeSeconds(expiresInSeconds);

const values = computed(() =>
  sampleValues({ projectName: projects.current.name, expiresInSeconds }),
);

/*
 * One row per message type, with the resolution worked out for the language on the
 * control. `status` is the answer to the only question the table exists to answer: whose
 * words does somebody actually receive, and are they the ones just published.
 */
interface TemplateRow {
  type: EmailTemplateType;
  entry: TemplateCatalogueEntry;
  label: string;
  status: TemplateStatus;
  /** The language that supplied the copy, which is rarely the one asked for. */
  from: string;
  locales: string[];
  /** True where this project holds unpublished copy for the message. */
  drafting: boolean;
  subject: string;
  renderedSubject: string;
  updatedAt: string | null;
}

const rows = computed<TemplateRow[]>(() => {
  const drafting = store.typesWithDrafts(projects.current.id);

  return TEMPLATE_CATALOGUE.map((entry) => {
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
    const subject = stored?.subject ?? BUILT_IN[entry.type]?.subject ?? "";

    return {
      type: entry.type,
      entry,
      label: entry.label,
      status: statusOf({
        live: entry.live,
        source: resolution.source,
        compiling: locales.length - sending.length,
      }),
      from: resolution.locale,
      locales,
      drafting: drafting.has(entry.type),
      subject,
      renderedSubject: renderPreview(subject, values.value, "text"),
      updatedAt: latest?.updatedAt ?? null,
    };
  });
});

/* The tabs, in the words the note settled on: what a project wrote, what it did not, and
   the ones no flow sends yet. "Yours" and "Copy in use" both had to be translated by the
   reader before they meant anything. */
const filterTab = ref("all");

const counts = computed(() => ({
  all: rows.value.length,
  custom: rows.value.filter((row) => row.locales.length > 0).length,
  built_in: rows.value.filter((row) => row.locales.length === 0 && row.entry.live).length,
  unavailable: rows.value.filter((row) => !row.entry.live).length,
}));

const filterOptions = computed(() => [
  { value: "all", label: `All · ${counts.value.all}` },
  { value: "custom", label: `Custom · ${counts.value.custom}` },
  { value: "built_in", label: `Built-in · ${counts.value.built_in}` },
  { value: "unavailable", label: `Unavailable · ${counts.value.unavailable}` },
]);

const query = ref("");

function inTab(row: TemplateRow): boolean {
  if (filterTab.value === "all") return true;
  if (filterTab.value === "custom") return row.locales.length > 0;
  if (filterTab.value === "built_in") return row.locales.length === 0 && row.entry.live;
  return !row.entry.live;
}

const listed = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return rows.value.filter((row) => {
    const matches =
      needle === "" ||
      row.label.toLowerCase().includes(needle) ||
      row.type.includes(needle) ||
      row.renderedSubject.toLowerCase().includes(needle) ||
      row.subject.toLowerCase().includes(needle);
    return inTab(row) && matches;
  });
});

const STATUS_TONES: Record<TemplateStatus, "success" | "warning" | "neutral"> = {
  active: "success",
  compiling: "warning",
  built_in: "neutral",
  unavailable: "neutral",
};

const STATUS_ORDER: Record<TemplateStatus, number> = {
  active: 0,
  compiling: 1,
  built_in: 2,
  unavailable: 3,
};

const COLUMNS: readonly DataTableColumn<TemplateRow>[] = [
  { key: "label", title: "Message", fixed: true, minWidth: 210 },
  {
    key: "status",
    title: "Status",
    width: 140,
    skeleton: "pill",
    value: (row) => STATUS_ORDER[row.status],
  },
  {
    key: "from",
    title: "Effective language",
    width: 150,
    mono: true,
    value: (row) => row.from,
  },
  { key: "renderedSubject", title: "Rendered subject", minWidth: 280 },
  {
    key: "locales",
    title: "Languages",
    width: 150,
    hidden: true,
    skeleton: "glyphs",
    value: (row) => row.locales.length,
  },
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

/**
 * Where Edit goes: the workspace, opened on the language whose copy a send would use.
 *
 * The language is a query parameter rather than a second path segment, because it is a
 * view of one message and not a resource of its own, and because a link somebody is sent
 * has to carry it.
 */
function editHref(row: TemplateRow): string {
  const locale =
    row.locales.length > 0 ? row.from : (localeChain(reader.value)[0] ?? DEFAULT_LOCALE);
  return `/email/templates/${row.type}?lang=${locale}`;
}

/* What this project has written, as the figures above the list. Each one that can be
   narrowed to is a link to its own filter, so a count is never a dead end. */
const languages = computed(
  () => new Set(store.forProject(projects.current.id).map((row) => row.locale)).size,
);
const compiling = computed(
  () => store.forProject(projects.current.id).filter((row) => !row.compiled).length,
);
const drafting = computed(() => rows.value.filter((row) => row.drafting));

const totals = computed(() => [
  {
    label: "Messages you have written",
    value: `${counts.value.custom}`,
    unit: `/ ${rows.value.length}`,
    action: counts.value.custom === 0 ? "Every message uses our copy" : "Show them",
    click: counts.value.custom === 0 ? null : () => showTab("custom"),
  },
  {
    label: "Languages",
    value: `${languages.value}`,
    unit: "",
    action: languages.value === 0 ? "English built-ins only" : "Across every message",
    click: null,
  },
  {
    label: "Compiling",
    value: `${compiling.value}`,
    unit: "",
    action: compiling.value === 0 ? "Nothing waiting" : "Built-in copy sends until it lands",
    click: null,
  },
  {
    label: "Unpublished drafts",
    value: `${drafting.value.length}`,
    unit: "",
    action: drafting.value.length === 0 ? "Nothing unsaved" : "Open the first",
    to: drafting.value.length === 0 ? null : editHref(drafting.value[0] as TemplateRow),
  },
]);

function showTab(tab: string) {
  filterTab.value = tab;
}

/* What the language on the control actually resolves to, spelled out under the table. */
const chain = computed(() => localeChain(reader.value));

const GUIDES = [
  {
    icon: "material-symbols:mail-outline",
    title: "Template studio",
    detail: "The types, the variables each carries, and how a locale resolves.",
    href: "https://idenzy.io/docs/email/templates",
  },
  {
    icon: "material-symbols:code",
    title: "The template language",
    detail: "Substitution only, why there are no conditionals, and what escaping covers.",
    href: "https://idenzy.io/docs/email/language",
  },
  {
    icon: "material-symbols:translate",
    title: "Languages and fallback",
    detail: "The chain, and why your English beats our Turkish.",
    href: "https://idenzy.io/docs/email/locales",
  },
  {
    icon: "material-symbols:terminal",
    title: "idenzy templates pull/push",
    detail: "Keeping copy in your own repository and shipping it with a release.",
    href: "https://idenzy.io/docs/cli/templates",
  },
];
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="Email templates">
      <template #description>
        The transactional mail
        <span class="font-medium text-ink">{{ projects.current.name }}</span> sends. Every
        message has copy behind it from the start, so this is a catalogue rather than a
        list of what you have written, and each row says whose words a reader actually
        gets.
      </template>
      <template #actions>
        <div class="flex items-center gap-2">
          <span class="text-xs whitespace-nowrap text-ink/55">Preview recipient language</span>
          <SegmentedControl
            v-model="reader"
            :options="readerOptions"
            label="Preview recipient language"
          />
        </div>
      </template>
    </PageHeader>

    <!--
      The totals, as a strip rather than tiles: every figure here is the count of something
      the list below can be narrowed to, so each one carries its own way in. The rules
      between the cells are the container's background through a one-pixel gap, which is
      right at every breakpoint where a per-cell border would need turning off at an edge.
    -->
    <div
      class="grid gap-px overflow-hidden rounded-(--idenzy-radius) border border-line bg-line sm:grid-cols-2 xl:grid-cols-4"
    >
      <div
        v-for="total in totals"
        :key="total.label"
        class="flex min-w-0 flex-col gap-1.5 bg-surface px-4 py-3.5"
      >
        <span class="text-xs text-ink/55">{{ total.label }}</span>

        <span
          v-if="store.loading"
          aria-hidden="true"
          class="h-5 w-16 animate-pulse rounded-full bg-ink/8"
        />
        <span v-else class="flex min-w-0 items-baseline gap-1">
          <span class="font-mono text-lg leading-6 font-medium text-ink tabular-nums">
            {{ total.value }}
          </span>
          <span v-if="total.unit" class="font-mono text-xs text-ink/45">{{ total.unit }}</span>
        </span>

        <NuxtLink
          v-if="total.to"
          :to="total.to"
          class="text-left text-xs text-ink/55 no-underline transition-colors hover:text-ink"
        >
          {{ total.action }}
        </NuxtLink>
        <button
          v-else-if="total.click"
          class="cursor-pointer appearance-none border-0 bg-transparent p-0 text-left text-xs text-ink/55 transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          type="button"
          @click="total.click()"
        >
          {{ total.action }}
        </button>
        <span v-else class="text-xs text-ink/40">{{ total.action }}</span>
      </div>
    </div>

    <!--
      The list: a heading on the page, then the card, with the controls that narrow it
      along the top and the table under them. The heading sits above the card rather than
      in a strip inside it, which is where every other list in this panel puts its name.
    -->
    <section class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-col gap-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">Every message</h2>
        <p class="m-0 text-xs text-ink/55">
          The subject column is rendered with sample values, as a reader would see it in
          their inbox. Hover one to read the template behind it.
        </p>
      </header>

      <v-card border flat>
        <div
          class="flex flex-col gap-3 border-b border-line p-3 lg:flex-row lg:items-center lg:justify-between"
        >
          <SegmentedControl v-model="filterTab" :options="filterOptions" label="Messages" />

          <div class="flex flex-wrap items-center gap-2">
            <v-text-field
              v-model="query"
              aria-label="Search messages"
              class="templates__search w-full sm:w-72"
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
                <span class="flex min-w-0 items-center gap-1.5">
                  <span class="truncate text-xs font-medium text-ink">{{ item.label }}</span>
                  <span
                    v-if="item.drafting"
                    class="inline-flex flex-none items-center gap-1 rounded-full border border-warning/40 px-1.5 text-[10px] leading-4 font-medium text-warning"
                  >
                    Draft
                  </span>
                </span>
                <span class="truncate font-mono text-[10px] leading-4 text-ink/45">
                  {{ item.type }}
                </span>
              </span>
            </span>
          </template>

          <!-- The one column the table exists for: whose words go out, and whether the
               copy that was published is the copy that is being sent yet. -->
          <template #cell.status="{ item }">
            <v-tooltip
              :text="
                item.status === 'compiling'
                  ? 'Published and still on the worker pool. The built-in is what sends until it lands.'
                  : item.status === 'unavailable'
                    ? 'No flow sends this message yet. Copy written now is stored and waits.'
                    : item.status === 'active'
                      ? 'This project\'s own copy is what a reader receives.'
                      : 'Our copy is what a reader receives.'
              "
              location="top"
            >
              <template #activator="{ props: tip }">
                <span v-bind="tip" class="inline-flex">
                  <StatusBadge
                    :label="TEMPLATE_STATUS_LABELS[item.status]"
                    :tone="STATUS_TONES[item.status]"
                  />
                </span>
              </template>
            </v-tooltip>
          </template>

          <template #cell.from="{ item }">
            <span
              v-if="item.status === 'unavailable'"
              class="font-mono text-[11px] text-ink/40"
            >
              —
            </span>
            <span v-else class="flex items-center gap-1.5">
              <span class="font-mono text-[11px] text-ink/75">{{ item.from }}</span>
              <span v-if="item.from !== reader" class="text-[10px] text-ink/45">
                (fallback)
              </span>
            </span>
          </template>

          <template #cell.renderedSubject="{ item }">
            <v-tooltip :text="item.subject" location="top" max-width="420">
              <template #activator="{ props: tip }">
                <span v-bind="tip" class="truncate text-xs text-ink/80">
                  {{ item.renderedSubject || "—" }}
                </span>
              </template>
            </v-tooltip>
          </template>

          <template #cell.locales="{ item }">
            <span v-if="item.locales.length === 0" class="text-xs text-ink/45">—</span>
            <span v-else class="flex flex-wrap items-center gap-1">
              <span
                v-for="locale in item.locales"
                :key="locale"
                :class="
                  store.find(projects.current.id, item.type, locale)?.compiled === false
                    ? 'border-warning/50 text-warning'
                    : 'border-line text-ink/70'
                "
                class="inline-flex rounded-full border px-1.5 font-mono text-[10px] leading-4"
              >
                {{ locale }}
              </span>
            </span>
          </template>

          <template #cell.trigger="{ item }">
            <span class="truncate text-xs text-ink/70">{{ item.entry.trigger }}</span>
          </template>

          <template #cell.updatedAt="{ item }">
            <v-tooltip v-if="item.updatedAt" :text="formatDateTime(item.updatedAt)" location="top">
              <template #activator="{ props: tip }">
                <span v-bind="tip" class="font-mono text-[11px] text-ink/70 tabular-nums">
                  {{ relativeTime(item.updatedAt, now) }}
                </span>
              </template>
            </v-tooltip>
            <span v-else class="text-xs text-ink/45">Never</span>
          </template>

          <!-- A visible row action rather than an ellipsis: editing is the one thing
               anybody comes to this table to do. -->
          <template #actions="{ item }">
            <v-btn
              :to="editHref(item)"
              class="text-xs font-medium"
              color="neutral"
              size="small"
              variant="text"
            >
              {{ item.locales.length > 0 ? "Edit" : "Customise" }}
            </v-btn>
          </template>
        </DataTable>

        <div
          class="grid gap-4 border-t border-line bg-ink/3 px-4 py-3.5 text-[11px] leading-4 sm:grid-cols-2"
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
      </v-card>
    </section>

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
            content rendered on our servers with our data in scope, so anything that can
            evaluate is a sandbox escape waiting to be found. Anything else in braces is
            not a placeholder and is sent to the reader as typed.
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
          description="A name that is not in scope for the message fails the send rather than rendering an empty string. A sign-in mail with no code in it is worse than one that never arrived: the first is found by a user who cannot get in, the second by us. The editor marks it as you type and refuses the publish for the same reason."
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
            https URL, and a value carrying an executable scheme is refused before escaping
            is considered. Escaping does not help in an
            <span class="font-mono text-ink/80">href</span>: a correctly quoted attribute
            whose whole value is a script URL is still a script. The link itself is signed
            and pinned to a registered redirect target before it reaches the template, so a
            body cannot make an open redirect out of it.
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
      description="What happens between publishing a template and a reader receiving it."
      expandable
      title="Publishing and sending"
    >
      <div class="divide-y divide-line">
        <SettingRow
          description="A published body is compiled off the request path, on the worker pool, and the result is cached by version. Until that has happened the row reads as absent and the built-in is what goes out, which is deliberate: a row that has not compiled is not something to send, and an empty mail would be worse than ours. The list marks that window as Compiling rather than Custom."
          fixed="Worker pool"
          label="Compiling"
        />
        <SettingRow
          description="A project's whole fallback chain is tried before any built-in of ours. A project that has translated English and not Turkish sends their English to a Turkish reader, because their copy carries their product's name and voice and ours carries neither."
          fixed="Yours first"
          label="Which copy wins"
        />
        <SettingRow
          description="One row per message and language, and a publish writes all three bodies at once. They are one message: a subject stored against a body somebody else replaced is a mail nobody wrote."
          fixed="Whole"
          label="How a publish is written"
        />
        <SettingRow
          description="Removing your copy for a language is reverting rather than deleting: the built-in is behind it and the message keeps sending. There is no state in which a project sends nothing because a template is missing."
          fixed="Reverts"
          label="Removing a template"
        />
        <SettingRow
          description="Unpublished copy is held while this panel is open and lost on a reload. It is never written to browser storage, because a draft is your unpublished copy and a dashboard is opened on shared machines."
          fixed="This session"
          label="Where a draft lives"
        />
        <SettingRow
          description="The sending address belongs to the deployment today, and a per-message from-name, reply-to and custom headers are named in the design and not built. A verified sending domain of your own is the change that makes them worth having."
          fixed="Not built"
          label="From, reply-to and headers"
        />
      </div>
    </LayerCard>

    <LayerCard :padded="false" title="Guides">
      <ul class="m-0 grid list-none grid-cols-1 gap-px bg-line p-0 sm:grid-cols-2 lg:grid-cols-4">
        <li v-for="guide in GUIDES" :key="guide.href" class="bg-surface">
          <a
            :href="guide.href"
            class="flex h-full items-start gap-3 px-4 py-3 text-xs no-underline transition-colors duration-150 hover:bg-ink/3"
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
              <span class="text-[11px] leading-4 text-ink/55">{{ guide.detail }}</span>
            </span>
          </a>
        </li>
      </ul>
    </LayerCard>
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

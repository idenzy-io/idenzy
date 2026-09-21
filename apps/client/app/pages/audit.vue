<script setup lang="ts">
/**
 * What happened on this project, and who did it (PROJECT.md 4.11, 4.13.3,
 * notes/audit.md).
 *
 * A record rather than a log. The rows are sentences with a person at the front, grouped
 * under the day they happened on, because that is how somebody looks back at a month: by
 * the day, and by the name. The identifiers, the request, the address and the chain are
 * behind each row, where they are needed once a reader has found the entry they came for.
 *
 * The one editorial decision is what the list opens on, and the note's first finding is
 * that it used to be invisible. The trail holds everything a project's own users do as
 * well, and on a live project that is nearly every row: an organisation's audit log where
 * nine entries in ten are "somebody signed in" is one nobody reads. So that traffic starts
 * out of the list — but it starts out of the list *on a chip in the filter row*, with the
 * count on it and one control that brings it back. An exclusion an auditor cannot see is
 * an exclusion they will not account for.
 *
 * What the screen may claim about itself is the other finding. The runtime role holds
 * INSERT and SELECT and no UPDATE or DELETE, and the chain makes an alteration detectable.
 * Neither of those means nobody with direct access to storage can change a row, so the
 * header says entries cannot be edited through the product and `INTEGRITY_CLAIMS` says the
 * rest of it in three lines that each stop where the guarantee stops.
 */
import {
  ACTOR_ICONS,
  ACTOR_LABELS,
  ACTOR_NOTES,
  type ActorType,
  AUDIT_CATEGORIES,
  type AuditCategory,
  type AuditFilters,
  actorsIn,
  auditCsv,
  auditFilterCount,
  auditScope,
  CATEGORY_LABELS,
  filterAudit,
  groupByDay,
  hiddenEndUserCount,
  INTEGRITY_CLAIMS,
  isContiguous,
  NO_AUDIT_FILTERS,
  RELAY_INTERVAL_SECONDS,
  RETENTION_YEARS,
  SENSITIVE_CRITERION,
  SENSITIVE_LABEL,
  shortHash,
  summarise,
  TEAM_ACTORS,
} from "~/utils/audit";
import { type TimeWindow, WINDOW_LABELS } from "~/utils/filters";

const projects = useProjectStore();
const store = useAuditStore();

/* A record of the recent past has to keep agreeing with the clock, or "today" drifts. */
const now = useNow({ interval: 60_000 });

const events = computed(() => store.forProject(projects.current.id));
const tip = computed(() => store.tipOf(projects.current.id));

const filters = ref<AuditFilters>({ ...NO_AUDIT_FILTERS });
const filterCount = computed(() => auditFilterCount(filters.value));

const shown = computed(() => filterAudit(events.value, filters.value, now.value));
const days = computed(() => groupByDay(shown.value, now.value));
const summary = computed(() => summarise(shown.value));
const hidden = computed(() => hiddenEndUserCount(events.value, filters.value, now.value));

/** Who appears in the window at all, so the list offers names rather than every role. */
const people = computed(() =>
  actorsIn(
    filterAudit(events.value, { ...NO_AUDIT_FILTERS, window: filters.value.window }, now.value),
  ),
);

const selectedPerson = computed(
  () => people.value.find((person) => person.id === filters.value.actorId) ?? null,
);

/**
 * Whether the rows on screen are an unbroken run of the chain. Anything narrowed and they
 * are not, so the panel stops claiming a link between one row and the next.
 */
const contiguous = computed(() => filterCount.value === 0 && isContiguous(shown.value));

/** Whether the read hit its bound, which is what makes the figures above a subset. */
const truncated = computed(() => store.isTruncated(projects.current.id));

/* How many rows are drawn at once. A month of trail is thousands of entries and the
   browser is asked for none of them until somebody asks for more. */
const PAGE = 40;
const drawn = ref(PAGE);
const visible = computed(() => shown.value.slice(0, drawn.value));
const visibleDays = computed(() => groupByDay(visible.value, now.value));

watch(
  () => [filters.value, projects.current.id],
  () => {
    drawn.value = PAGE;
    openId.value = null;
  },
  { deep: true },
);

const openId = ref<string | null>(null);

/* Reference. The trail is the visit; how it is kept is read once. */
const expanded = reactive({ integrity: false });

function toggle(id: string) {
  openId.value = openId.value === id ? null : id;
}

/*
 * Narrowing it.
 */

const WINDOWS: readonly TimeWindow[] = ["24h", "7d", "30d", "90d", "any"];

const windowOptions = computed(() =>
  WINDOWS.map((window) => ({
    value: window,
    /* "All" alone reads as "the complete trail", which this view is not while the
       end-user activity is set aside. It is a period, so it says so. */
    label: window === "any" ? "All time" : window,
    title: WINDOW_LABELS[window],
  })),
);

function setWindow(value: string) {
  const window = value as TimeWindow;
  filters.value = { ...filters.value, window };
  /* The period is the one control that changes what exists rather than what is shown: the
     API is what narrows to it, so widening has to go back and ask. */
  void store.setWindow(projects.current.id, window);
}

function toggleActor(actor: ActorType) {
  const held = filters.value.actors;
  filters.value = {
    ...filters.value,
    actors: held.includes(actor) ? held.filter((entry) => entry !== actor) : [...held, actor],
  };
}

function toggleCategory(category: AuditCategory) {
  const held = filters.value.categories;
  filters.value = {
    ...filters.value,
    categories: held.includes(category)
      ? held.filter((entry) => entry !== category)
      : [...held, category],
  };
}

function onlyActor(id: string) {
  filters.value = { ...filters.value, actorId: filters.value.actorId === id ? null : id };
}

function clear() {
  filters.value = { ...NO_AUDIT_FILTERS, window: filters.value.window };
}

/*
 * Taking a copy. Reviewed before it is taken: the button says "filtered view" and the
 * dialog is what makes that checkable.
 */

const exportOpen = ref(false);

const scope = computed(() => {
  const lines = auditScope(
    filters.value,
    projects.current.name,
    shown.value.length,
    WINDOW_LABELS[filters.value.window],
  );
  /* The dialog exists to stop somebody reading a narrowed file as the whole trail, and the
     read's own bound is a second way it is narrow — one the filters do not mention. */
  if (truncated.value) {
    lines.push({
      label: "Not the whole period",
      value: "The most recent entries only, as far back as one read goes",
    });
  }
  return lines;
});

function exportCsv() {
  exportOpen.value = false;
  const blob = new Blob([auditCsv(shown.value)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `idenzy-audit-${projects.current.id}-${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="flex w-full flex-col gap-5">
    <PageHeader title="Audit log">
      <template #description>
        What happened on
        <span class="font-medium text-ink">{{ projects.current.name }}</span
        >, and who did it. Entries cannot be edited through the product, and the chain makes
        a change underneath it detectable.
      </template>
      <template #actions>
        <v-btn
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:download"
          size="small"
          variant="text"
          @click="exportOpen = true"
        >
          Export Filtered View
        </v-btn>
      </template>
    </PageHeader>

    <!--
      Search first and full width, then every filter in force under it. The note asks for
      all of them above the timeline, because the one thing an auditor has to be able to
      say about a view is what it leaves out.
    -->
    <div class="flex flex-col gap-3">
      <v-text-field
        v-model="filters.text"
        aria-label="Search the record"
        class="audit__search"
        clearable
        density="comfortable"
        hide-details
        placeholder="Search an actor, a resource or a request ID"
        prepend-inner-icon="material-symbols:search"
        variant="outlined"
      />

      <div class="flex flex-wrap items-center gap-2">
        <SegmentedControl
          :model-value="filters.window"
          :options="windowOptions"
          label="Time range"
          @update:model-value="setWindow"
        />

        <v-menu :close-on-content-click="false" :offset="6" location="bottom start">
          <template #activator="{ props: activator }">
            <v-btn
              v-bind="activator"
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:badge-outline"
              size="small"
              variant="text"
            >
              Actor
              <span v-if="filters.actors.length > 0" class="ml-1.5 font-mono text-primary">
                {{ filters.actors.length }}
              </span>
            </v-btn>
          </template>
          <v-list density="compact" min-width="300" nav>
            <v-list-item
              v-for="actor in TEAM_ACTORS"
              :key="actor"
              :active="filters.actors.includes(actor)"
              :prepend-icon="ACTOR_ICONS[actor]"
              :subtitle="ACTOR_NOTES[actor]"
              :title="ACTOR_LABELS[actor]"
              @click="toggleActor(actor)"
            />
          </v-list>
        </v-menu>

        <v-menu :close-on-content-click="false" :offset="6" location="bottom start">
          <template #activator="{ props: activator }">
            <v-btn
              v-bind="activator"
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:category-outline"
              size="small"
              variant="text"
            >
              Action
              <span v-if="filters.categories.length > 0" class="ml-1.5 font-mono text-primary">
                {{ filters.categories.length }}
              </span>
            </v-btn>
          </template>
          <v-list density="compact" min-width="220" nav>
            <v-list-item
              v-for="category in AUDIT_CATEGORIES"
              :key="category"
              :active="filters.categories.includes(category)"
              :title="CATEGORY_LABELS[category]"
              @click="toggleCategory(category)"
            />
          </v-list>
        </v-menu>

        <!--
          The exclusion, on a chip rather than in a rail. It is the largest thing this
          view leaves out and it was the least visible; now it carries its own count and
          its own way off (notes/audit.md P1).
        -->
        <button
          v-if="!filters.includeEndUsers"
          class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-(--idenzy-radius-x-small) bg-ink/4 px-2.5 text-xs font-medium text-ink ring-1 ring-ink/10 ring-inset transition-colors duration-150 hover:bg-ink/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          type="button"
          @click="filters.includeEndUsers = true"
        >
          <Icon aria-hidden="true" class="text-sm text-ink/50" name="material-symbols:filter-alt" />
          Administrative activity only
          <span v-if="hidden > 0" class="font-mono text-ink/50 tabular-nums">
            {{ hidden.toLocaleString("en") }} set aside
          </span>
          <Icon aria-hidden="true" class="text-sm text-ink/45" name="material-symbols:close" />
        </button>
        <button
          v-else
          class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-(--idenzy-radius-x-small) bg-primary/8 px-2.5 text-xs font-medium text-primary ring-1 ring-primary/30 ring-inset transition-colors duration-150 hover:bg-primary/12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          type="button"
          @click="filters.includeEndUsers = false"
        >
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:group-outline" />
          Your users' activity included
          <Icon aria-hidden="true" class="text-sm opacity-70" name="material-symbols:close" />
        </button>

        <!-- A category with a rule behind it, and the rule is one hover away rather than
             an editorial judgement about everything else (notes/audit.md P2). -->
        <v-tooltip :text="SENSITIVE_CRITERION" location="bottom" max-width="360">
          <template #activator="{ props: tip }">
            <v-btn
              v-bind="tip"
              :color="filters.notableOnly ? 'warning' : 'neutral'"
              :variant="filters.notableOnly ? 'tonal' : 'outlined'"
              class="text-xs font-medium"
              prepend-icon="material-symbols:flag-outline"
              size="small"
              @click="filters.notableOnly = !filters.notableOnly"
            >
              {{ SENSITIVE_LABEL }} changes only
            </v-btn>
          </template>
        </v-tooltip>

        <button
          v-if="filterCount > 0"
          class="ml-auto cursor-pointer border-0 bg-transparent p-0 text-xs font-medium text-ink/70 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          type="button"
          @click="clear"
        >
          Clear {{ filterCount }} {{ filterCount === 1 ? "filter" : "filters" }}
        </button>
      </div>
    </div>

    <!-- Eight columns of record, four of who and what is excluded. -->
    <div class="grid gap-6 lg:grid-cols-12 lg:items-start">
      <div class="flex min-w-0 flex-col gap-4 lg:col-span-8">
        <p class="m-0 px-1 text-xs text-ink/55">
          <span class="font-medium text-ink">
            <template v-if="selectedPerson">{{ selectedPerson.name }}</template>
            <template v-else>Everything that happened</template>
          </span>
          <span class="mx-1.5 text-ink/25">·</span>
          <span class="font-mono text-ink/70 tabular-nums">{{ summary.changes }}</span>
          {{ summary.changes === 1 ? "entry" : "entries" }} by
          <span class="font-mono text-ink/70 tabular-nums">{{ summary.people }}</span>
          {{ summary.people === 1 ? "actor" : "actors" }},
          {{ WINDOW_LABELS[filters.window].toLowerCase() }}
        </p>

        <!--
          The one claim wiring took off this screen. The placeholder could total a period
          because it had invented all of it; the trail is read newest-first and bounded, so
          past that bound these figures describe what was fetched and not the period. Said
          here rather than left implied, because a count that is quietly partial is worse
          than one that admits it.
        -->
        <InfoNote
          v-if="truncated"
          :text="`These figures cover the most recent ${events.length.toLocaleString('en')} entries, which is as far back as one read goes. Narrow the period to total a whole one.`"
          class="mx-1"
          tone="warning"
        />

        <InfoNote
          v-if="store.refusal"
          :text="store.refusal"
          class="mx-1"
          icon="material-symbols:error-outline"
          tone="warning"
        />

        <div
          v-if="store.loading"
          class="divide-y divide-line overflow-hidden rounded-(--idenzy-radius) border border-line bg-surface"
        >
          <div v-for="row in 6" :key="row" class="flex items-center gap-3 px-4 py-3.5">
            <span class="size-8 flex-none animate-pulse rounded-full bg-ink/8" />
            <span class="flex min-w-0 flex-1 flex-col gap-1.5">
              <span
                :style="{ width: `${40 + ((row * 11) % 35)}%` }"
                class="h-2.5 animate-pulse rounded-full bg-ink/8"
              />
              <span class="h-2 w-32 animate-pulse rounded-full bg-ink/6" />
            </span>
            <span class="h-2 w-14 flex-none animate-pulse rounded-full bg-ink/6" />
          </div>
        </div>

        <div
          v-else-if="shown.length === 0"
          class="overflow-hidden rounded-(--idenzy-radius) border border-line bg-surface"
        >
          <EmptyState
            :description="
              filterCount > 0
                ? 'Nothing in this window matches. The record is not missing anything: widen the period or clear a filter.'
                : 'Nobody has changed anything on this project in this window. Entries appear within seconds of the thing they record.'
            "
            icon="material-symbols:history"
            title="Nothing happened here"
          >
            <template v-if="filterCount > 0" #actions>
              <v-btn
                class="text-xs font-medium"
                color="neutral"
                size="small"
                variant="text"
                @click="clear"
              >
                Clear filters
              </v-btn>
            </template>
          </EmptyState>
        </div>

        <template v-else>
          <section v-for="day in visibleDays" :key="day.key" class="flex flex-col gap-2">
            <!-- A date heading rather than a timestamp on every row: a reader thinks in
                 days, and the exact instant matters once they have found the entry. -->
            <h3 class="m-0 flex items-baseline gap-2 px-1 text-xs font-medium text-ink">
              {{ day.label }}
              <span class="font-mono text-[11px] font-normal text-ink/40 tabular-nums">
                {{ day.events.length }}
              </span>
            </h3>
            <div
              class="divide-y divide-line/60 overflow-hidden rounded-(--idenzy-radius) border border-line bg-surface"
            >
              <AuditEntryRow
                v-for="event in day.events"
                :key="event.id"
                :contiguous="contiguous"
                :event="event"
                :now="now"
                :open="openId === event.id"
                @actor="onlyActor"
                @toggle="toggle(event.id)"
              />
            </div>
          </section>

          <div v-if="visible.length < shown.length" class="flex justify-center pt-1">
            <v-btn
              class="text-xs font-medium"
              color="neutral"
              size="small"
              variant="text"
              @click="drawn += PAGE"
            >
              Show {{ Math.min(PAGE, shown.length - visible.length) }} more
            </v-btn>
          </div>
        </template>
      </div>

      <aside class="flex min-w-0 flex-col gap-4 lg:col-span-4 lg:sticky lg:top-20">
        <!--
          What this view leaves out, in one place, because that is the question an auditor
          has to answer about any narrowed record.
        -->
        <LayerCard
          :padded="false"
          description="What is in this view and what is not."
          title="Known exclusions"
        >
          <ul class="m-0 list-none divide-y divide-line p-0">
            <li class="flex items-start gap-2.5 px-4 py-3">
              <Icon
                :class="filters.includeEndUsers ? 'text-success' : 'text-warning'"
                :name="
                  filters.includeEndUsers
                    ? 'material-symbols:check-circle-outline'
                    : 'material-symbols:filter-alt'
                "
                aria-hidden="true"
                class="mt-px flex-none text-base"
              />
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="text-xs leading-4 font-medium text-ink">
                  <template v-if="filters.includeEndUsers">
                    Your users' own activity is included
                  </template>
                  <template v-else>
                    <span class="font-mono tabular-nums">
                      {{ hidden.toLocaleString("en") }}
                    </span>
                    entries by your own users are set aside
                  </template>
                </span>
                <span class="text-[11px] leading-4 text-ink/55">
                  Sign-ins, sign-outs and account changes made by the people using your
                  product are in this trail too. On a live project they are most of it, so
                  they start out of the list rather than hidden.
                </span>
                <button
                  class="mt-1 w-fit cursor-pointer border-0 bg-transparent p-0 text-[11px] font-medium text-ink/70 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  type="button"
                  @click="filters.includeEndUsers = !filters.includeEndUsers"
                >
                  {{ filters.includeEndUsers ? "Set them aside again" : "Include them" }}
                </button>
              </span>
            </li>
            <li class="flex items-start gap-2.5 px-4 py-3">
              <Icon
                aria-hidden="true"
                class="mt-px flex-none text-base text-ink/40"
                name="material-symbols:schedule-outline"
              />
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="text-xs leading-4 font-medium text-ink">
                  {{ WINDOW_LABELS[filters.window] }}
                </span>
                <span class="text-[11px] leading-4 text-ink/55">
                  Kept {{ RETENTION_YEARS.standard }} year on this tier and
                  {{ RETENTION_YEARS.hipaa }} on HIPAA, then dropped a month at a time.
                  Anything older than the period is outside this view rather than gone.
                </span>
              </span>
            </li>
            <li v-if="filterCount > 0" class="flex items-start gap-2.5 px-4 py-3">
              <Icon
                aria-hidden="true"
                class="mt-px flex-none text-base text-ink/40"
                name="material-symbols:tune"
              />
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="text-xs leading-4 font-medium text-ink">
                  {{ filterCount }} {{ filterCount === 1 ? "filter" : "filters" }} narrowing it
                </span>
                <span class="text-[11px] leading-4 text-ink/55">
                  The chain is unbroken underneath; what is on screen is a selection of it, so
                  a row is not necessarily the entry before the one below it.
                </span>
              </span>
            </li>
          </ul>
        </LayerCard>

        <LayerCard
          :padded="false"
          description="Everyone who did something in this window, busiest first."
          title="Actors"
        >
          <ul v-if="people.length > 0" class="m-0 list-none divide-y divide-line p-0">
            <li v-for="person in people" :key="person.id">
              <button
                :class="filters.actorId === person.id ? 'bg-primary/8' : ''"
                class="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-ink/4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                type="button"
                @click="onlyActor(person.id)"
              >
                <Icon
                  :name="ACTOR_ICONS[person.type]"
                  aria-hidden="true"
                  class="flex-none text-sm text-ink/50"
                />
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate text-xs text-ink">{{ person.name }}</span>
                  <span class="truncate text-[10px] text-ink/45">
                    {{ ACTOR_LABELS[person.type] }}
                  </span>
                </span>
                <span class="flex-none font-mono text-[11px] text-ink/55 tabular-nums">
                  {{ person.count }}
                </span>
              </button>
            </li>
          </ul>
          <p v-else class="m-0 px-4 py-6 text-center text-xs text-ink/50">
            Nobody has done anything in this window.
          </p>
        </LayerCard>

        <!--
          Three claims, each stopping where the guarantee stops. Append-only grants and a
          hash chain do not add up to "nobody can ever alter storage" (notes/audit.md P2).
        -->
        <LayerCard
          v-model:open="expanded.integrity"
          :padded="false"
          description="What can and cannot be said about the entries themselves."
          expandable
          title="Integrity details"
        >
          <ul class="m-0 list-none divide-y divide-line p-0">
            <li
              v-for="claim in INTEGRITY_CLAIMS"
              :key="claim.id"
              class="flex flex-col gap-0.5 px-4 py-3"
            >
              <span class="text-xs leading-4 font-medium text-ink">{{ claim.label }}</span>
              <span class="text-[11px] leading-4 text-ink/55">{{ claim.detail }}</span>
            </li>
          </ul>
          <div class="flex flex-col gap-2 border-t border-line px-4 py-3">
            <p class="m-0 text-[11px] leading-4 text-ink/55">
              Entries appear about {{ RELAY_INTERVAL_SECONDS }} seconds after the thing they
              record, because one relay writes the chain and it sweeps on that interval. They
              are ordered by that sequence rather than by the clock: two entries can share a
              millisecond and the chain has one answer about which came first.
            </p>
            <p v-if="tip" class="m-0 flex items-center gap-1.5 font-mono text-[11px] text-ink/45">
              <Icon aria-hidden="true" class="text-xs" name="material-symbols:fingerprint" />
              Tip {{ shortHash(tip.entryHash) }}
            </p>
          </div>
        </LayerCard>
      </aside>
    </div>

    <!-- Mounted only while open, like every dialog here. -->
    <AuditExportDialog
      v-if="exportOpen"
      v-model="exportOpen"
      :empty="shown.length === 0"
      :scope="scope"
      @confirm="exportCsv"
    />
  </div>
</template>

<style scoped>
/* A search box at the height of the buttons beside it, in the toolbar's small type and on
   the small radius, so the row reads as one set. The same block the users and sessions
   toolbars carry: three toolbars that looked like three products is what this avoids. */
.audit__search :deep(.v-field) {
  --v-input-control-height: 32px;

  border-radius: var(--idenzy-radius-small);
  font-size: 0.75rem;
}

.audit__search :deep(.v-field__input),
.audit__search :deep(.v-field__input::placeholder) {
  font-size: 0.75rem;
}

.audit__search :deep(.v-field__prepend-inner > .v-icon),
.audit__search :deep(.v-field__clearable > .v-icon) {
  font-size: 1rem;
}
</style>

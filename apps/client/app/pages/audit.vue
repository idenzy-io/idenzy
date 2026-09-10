<script setup lang="ts">
/**
 * What happened on this project, and who did it (PROJECT.md 4.11, 4.13.3).
 *
 * A record rather than a log. The rows are sentences with a person at the front, grouped
 * under the day they happened on, because that is how somebody looks back at a month: by
 * the day, and by the name. The identifiers, the address and the hash chain are behind
 * each row, where they are needed once a reader has found the entry they came for.
 *
 * The one editorial decision is what the list opens on. The trail holds everything a
 * project's own users do as well, and on a live project that is nearly every row: an
 * organisation's audit log where nine entries in ten are "somebody signed in" is one
 * nobody reads. So that traffic starts out of the list, counted rather than hidden, and
 * one switch brings it back.
 *
 * Nothing here writes. The runtime role holds INSERT and SELECT on `audit_events` and no
 * UPDATE or DELETE at all, so no control on this page could change an entry even if one
 * were added, and the export is a copy of what is on screen.
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
  CATEGORY_LABELS,
  filterAudit,
  groupByDay,
  hiddenEndUserCount,
  isContiguous,
  NO_AUDIT_FILTERS,
  RELAY_INTERVAL_SECONDS,
  RETENTION_YEARS,
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
    label: window === "any" ? "All" : window,
    title: WINDOW_LABELS[window],
  })),
);

function setWindow(value: string) {
  filters.value = { ...filters.value, window: value as TimeWindow };
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
 * Taking a copy.
 */

function exportCsv() {
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
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:history" title="Audit log">
      <template #description>
        What happened on
        <span class="font-medium text-ink">{{ projects.current.name }}</span
        >, and who did it. Append-only by database grant: nothing here, and no code path we
        could write, can change an entry.
      </template>
      <template #actions>
        <v-btn
          :disabled="shown.length === 0"
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:download"
          size="small"
          variant="outlined"
          @click="exportCsv"
        >
          Export
        </v-btn>
      </template>
    </PageHeader>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px] xl:items-start">
      <div class="flex min-w-0 flex-col gap-4">
        <!-- The toolbar the users and sessions lists carry: the period on the left, the
             search and the ways of narrowing it on the right. -->
        <div
          class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
        >
          <SegmentedControl
            :model-value="filters.window"
            :options="windowOptions"
            label="Window"
            @update:model-value="setWindow"
          />

          <div class="flex flex-wrap items-center gap-2">
            <v-text-field
              v-model="filters.text"
              aria-label="Search the record"
              class="audit__search w-full sm:w-72"
              clearable
              density="comfortable"
              hide-details
              placeholder="Search people, actions and targets"
              prepend-inner-icon="material-symbols:search"
              variant="outlined"
            />

            <v-menu :close-on-content-click="false" :offset="6" location="bottom end">
              <template #activator="{ props: activator }">
                <v-btn
                  v-bind="activator"
                  class="text-xs font-medium"
                  color="neutral"
                  prepend-icon="material-symbols:category-outline"
                  size="small"
                  variant="outlined"
                >
                  What
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

            <v-menu :close-on-content-click="false" :offset="6" location="bottom end">
              <template #activator="{ props: activator }">
                <v-btn
                  v-bind="activator"
                  class="text-xs font-medium"
                  color="neutral"
                  prepend-icon="material-symbols:badge-outline"
                  size="small"
                  variant="outlined"
                >
                  Who
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

            <v-btn
              class="text-xs font-medium"
              :color="filters.notableOnly ? 'warning' : 'neutral'"
              prepend-icon="material-symbols:flag-outline"
              size="small"
              :variant="filters.notableOnly ? 'tonal' : 'outlined'"
              @click="filters.notableOnly = !filters.notableOnly"
            >
              Worth reading
            </v-btn>
          </div>
        </div>

        <!-- The record is not in a card. A day heading belongs between the groups rather
             than inside one, and each day is its own panel, so the page reads as a run of
             days rather than as one box with rules drawn across it. -->
        <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
          <p class="m-0 text-xs text-ink/55">
            <span class="font-medium text-ink">
              <template v-if="selectedPerson">{{ selectedPerson.name }}</template>
              <template v-else>Everything that happened</template>
            </span>
            <span class="mx-1.5 text-ink/25">·</span>
            <span class="font-mono tabular-nums text-ink/70">{{ summary.changes }}</span>
            {{ summary.changes === 1 ? "entry" : "entries" }} by
            <span class="font-mono tabular-nums text-ink/70">{{ summary.people }}</span>
            {{ summary.people === 1 ? "actor" : "actors" }},
            {{ WINDOW_LABELS[filters.window].toLowerCase() }}
          </p>
          <button
            v-if="filterCount > 0"
            class="cursor-pointer border-0 bg-transparent p-0 text-[11px] font-medium text-ink/70 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            type="button"
            @click="clear"
          >
            Clear {{ filterCount }} {{ filterCount === 1 ? "filter" : "filters" }}
          </button>
        </div>

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
                ? 'Nothing in this window matches. The record is not missing anything: widen the window or clear a filter.'
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
                variant="outlined"
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
              variant="outlined"
              @click="drawn += PAGE"
            >
              Show {{ Math.min(PAGE, shown.length - visible.length) }} more
            </v-btn>
          </div>
        </template>
      </div>

      <aside class="flex flex-col gap-4 xl:sticky xl:top-20">
        <LayerCard
          :padded="false"
          description="Everyone who did something in this window, busiest first."
          title="Who"
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

        <!-- The switch that decides what this screen is. Counted rather than hidden: a
             reader has to be able to see how much is being set aside for them. -->
        <LayerCard title="Your users' own activity">
          <div class="flex flex-col gap-3">
            <p class="m-0 text-xs leading-5 text-ink/60">
              Sign-ins, sign-outs and account changes made by the people using your product
              are in this trail too. On a live project they are most of it, so they are kept
              out of the list unless you ask.
            </p>
            <div class="flex items-center justify-between gap-3">
              <span class="text-xs text-ink">
                <template v-if="filters.includeEndUsers">Included</template>
                <template v-else>
                  <span class="font-mono tabular-nums">{{ hidden.toLocaleString("en") }}</span>
                  set aside
                </template>
              </span>
              <v-switch
                v-model="filters.includeEndUsers"
                aria-label="Include your users' own activity"
                color="primary"
                density="compact"
                hide-details
                inset
              />
            </div>
          </div>
        </LayerCard>

        <LayerCard title="How this is kept">
          <div class="flex flex-col gap-3 text-[11px] leading-4 text-ink/55">
            <p class="m-0">
              Every entry is hash-chained to the one before it for this project, so anyone
              with direct database access who changed one would be detected by verifying the
              chain. Open a row to see its links.
            </p>
            <p class="m-0">
              Entries appear about {{ RELAY_INTERVAL_SECONDS }} seconds after the thing they
              record, because one relay writes the chain and it sweeps on that interval.
              They are ordered by that sequence rather than by the clock: two entries can
              share a millisecond and the chain has one answer about which came first.
            </p>
            <p class="m-0">
              Kept {{ RETENTION_YEARS.standard }} year on this tier and
              {{ RETENTION_YEARS.hipaa }} on HIPAA, then dropped a month at a time.
            </p>
            <p v-if="tip" class="m-0 flex items-center gap-1.5 font-mono text-ink/45">
              <Icon aria-hidden="true" class="text-xs" name="material-symbols:fingerprint" />
              {{ shortHash(tip.entryHash) }}
            </p>
          </div>
        </LayerCard>
      </aside>
    </div>
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
  min-height: 32px;
}

.audit__search :deep(.v-field__prepend-inner > .v-icon),
.audit__search :deep(.v-field__clearable > .v-icon) {
  font-size: 1rem;
}
</style>

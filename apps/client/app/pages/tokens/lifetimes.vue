<script setup lang="ts">
/**
 * Every clock in the project: how long each credential stays usable (PROJECT.md 4.2,
 * packages/config/src/schema.ts). Three of them are a project's to move and the rest are
 * the deployment's, and the screen is arranged around that split rather than around which
 * subsystem issues what.
 *
 * The access-token lifetime is the reason this screen exists. It is one number that is
 * paid for in three places at once, so the three are worked out and set directly under the
 * control instead of described in a paragraph: what it costs in refreshes, how long a
 * revoked session outlives its revocation, and how long a suspended account keeps working.
 * The second of those depends on something the panel can only observe, whether anything
 * has ever polled this project's revocation snapshot, so the screen says which of the two
 * cases the project is actually in rather than explaining both (ADR-0009).
 *
 * The two session clocks are offered as a pair because they constrain each other: an idle
 * window past the maximum lifetime never fires, so it is not offered rather than saved and
 * quietly ignored. Under them the screen answers the question the two numbers are really
 * asked for, which is when a session ends, and the answer is different for one nobody
 * comes back to and one somebody uses every day.
 *
 * Everything else is a row that states a length and why it is that length. The table in
 * the middle is every one of them at once, sorted by length rather than by subsystem,
 * which is what makes an access token and a passkey challenge visibly the same five
 * minutes. The figures on the side are read off the sessions store rather than invented,
 * so this screen and the sessions list cannot disagree about what ended anything.
 */

import {
  type ColumnState,
  type DataTableColumn,
  type DataTableSort,
  defaultColumnState,
  reconcileColumnState,
} from "~/utils/data-table";
import {
  ABSOLUTE_CHOICES,
  ACCESS_TOKEN_CEILING_SECONDS,
  ACCESS_TOKEN_CHOICES,
  ACCESS_TOKEN_FLOOR_SECONDS,
  ACTIVE_SECONDS_PER_MONTH,
  CLOCK_GROUP_LABELS,
  choiceRange,
  durationChoices,
  durationParts,
  FIXED_CLOCKS,
  heldOpenEnd,
  IDLE_CHOICES,
  isAbsoluteOffered,
  isIdleOffered,
  type LifetimeSettings,
  REFRESH_TOKEN_SECONDS,
  REVOCATION_POLL_SECONDS,
  rangeWords,
  refreshesPerActiveUser,
  revocationWindowSeconds,
  SESSION_CLOCK_LABELS,
  shortDuration,
  shortDurationParts,
  snapshotRetentionSeconds,
  untouchedEnd,
} from "~/utils/lifetimes";
import { humanizeSeconds } from "~/utils/otp";
import { endedBy, endsAt, REASON_LABELS, type RevokeReason, sessionStatus } from "~/utils/sessions";
import { DURATIONS, relativeTimeWords } from "~/utils/time";

const projects = useProjectStore();
const store = useLifetimesStore();
const mfa = useMfaStore();
const sessions = useSessionsStore();

const saved = computed(() => store.settingsFor(projects.current.id));
const now = useNow({ interval: 60_000 });

/* Which cards start unfolded. The token is what most visits are for, so it and the
   session it belongs to are open and the fixed lists are not. */
const expanded = reactive({
  token: true,
  session: true,
  lengths: true,
  waiting: false,
  mail: false,
});

/* The fields on their way to the server, so each control shows its own wait. */
const busy = ref<Set<string>>(new Set());

function isBusy(key: string): boolean {
  return busy.value.has(key);
}

async function whileBusy(key: string, work: () => Promise<void>) {
  busy.value = new Set([...busy.value, key]);
  try {
    await work();
  } finally {
    busy.value = new Set([...busy.value].filter((entry) => entry !== key));
  }
}

/**
 * Each control hands back a string and stores a number. The patch is built by the caller
 * rather than from a key, because a computed key widens to a string index and the change
 * would no longer be checked against `LifetimeSettings` at all.
 */
function control(
  field: string,
  read: () => number,
  write: (value: number) => Partial<LifetimeSettings>,
) {
  return computed({
    get: () => String(read()),
    set: (value: string) => {
      const next = Number(value);
      if (!Number.isFinite(next) || next === read()) return;
      void whileBusy(field, () => store.patch(projects.current.id, write(next)));
    },
  });
}

const accessToken = control(
  "accessToken",
  () => saved.value.accessTokenSeconds,
  (accessTokenSeconds) => ({ accessTokenSeconds }),
);
const idle = control(
  "idle",
  () => saved.value.idleSeconds,
  (idleSeconds) => ({ idleSeconds }),
);
const absolute = control(
  "absolute",
  () => saved.value.absoluteSeconds,
  (absoluteSeconds) => ({ absoluteSeconds }),
);

const ACCESS_TOKEN_OPTIONS = durationChoices(ACCESS_TOKEN_CHOICES);

/*
 * The two session clocks constrain each other, and the refusal is made by not offering
 * the combination rather than by refusing a save that has already been asked for.
 */
const idleOptions = computed(() =>
  durationChoices(IDLE_CHOICES).map((choice) => ({
    ...choice,
    disabled: !isIdleOffered(Number(choice.value), saved.value.absoluteSeconds),
  })),
);

const absoluteOptions = computed(() =>
  durationChoices(ABSOLUTE_CHOICES).map((choice) => ({
    ...choice,
    disabled: !isAbsoluteOffered(Number(choice.value), saved.value.idleSeconds),
  })),
);

/*
 * What the access-token lifetime costs. Whether a revocation is seen in seconds or waited
 * out is not a setting: it is whether anything holding this project's secret key has ever
 * fetched the snapshot, which the panel can see and cannot change.
 */
const polledAt = computed(() => store.revocationPolledAt(projects.current.id));
const polling = computed(() => polledAt.value !== null);

const polledAgo = computed(() => {
  const at = polledAt.value;
  if (at === null) return "";
  const stamp = new Date(at);
  return relativeTimeWords(at, now.value < stamp ? stamp : now.value);
});

const refreshes = computed(() => refreshesPerActiveUser(saved.value.accessTokenSeconds));
const revocationWindow = computed(() =>
  revocationWindowSeconds(saved.value.accessTokenSeconds, polling.value),
);
const retention = computed(() => snapshotRetentionSeconds(saved.value.accessTokenSeconds));

const tokenLabel = computed(() => humanizeSeconds(saved.value.accessTokenSeconds));
const floorLabel = humanizeSeconds(ACCESS_TOKEN_FLOOR_SECONDS);
const ceilingLabel = humanizeSeconds(ACCESS_TOKEN_CEILING_SECONDS);
const activeHours = ACTIVE_SECONDS_PER_MONTH / 3600;

/* When a session ends, which is the question the two clocks below are actually asked. */
const untouched = computed(() => untouchedEnd(saved.value));
const heldOpen = computed(() => heldOpenEnd(saved.value));

/*
 * The list of lengths. The step-up window is in it and is read from the store that owns
 * it, so this screen and `/mfa/step-up` cannot quote two different numbers for one
 * setting.
 */
const stepUpSeconds = computed(() => mfa.stepUpFor(projects.current.id).maxAgeMinutes * 60);

const clocksIn = (group: "challenge" | "handoff" | "mail") =>
  FIXED_CLOCKS.filter((clock) => clock.group === group);

/**
 * One row per clock, for the table. `offered` is the control's own choices rather than a
 * range written out beside them, so the table cannot promise a lifetime the segmented
 * control above it refuses, and it is empty for the ones a project does not set: the
 * table draws an empty cell as a dash, which is the honest answer to "what can I pick".
 */
interface ClockRow {
  id: string;
  label: string;
  seconds: number;
  group: string;
  setHere: boolean;
  offered: string;
  /** The most the config schema accepts, where it caps one. Null where it does not. */
  capSeconds: number | null;
}

const SESSION_GROUP = "The session";

const clockRows = computed<ClockRow[]>(() => [
  {
    id: "access",
    label: "Access token",
    seconds: saved.value.accessTokenSeconds,
    group: SESSION_GROUP,
    setHere: true,
    offered: rangeWords(ACCESS_TOKEN_FLOOR_SECONDS, ACCESS_TOKEN_CEILING_SECONDS),
    capSeconds: ACCESS_TOKEN_CEILING_SECONDS,
  },
  {
    id: "idle",
    label: "Idle timeout",
    seconds: saved.value.idleSeconds,
    group: SESSION_GROUP,
    setHere: true,
    offered: offeredFrom(IDLE_CHOICES),
    capSeconds: null,
  },
  {
    id: "absolute",
    label: "Maximum lifetime",
    seconds: saved.value.absoluteSeconds,
    group: SESSION_GROUP,
    setHere: true,
    offered: offeredFrom(ABSOLUTE_CHOICES),
    capSeconds: null,
  },
  {
    id: "refresh",
    label: "Refresh token",
    seconds: REFRESH_TOKEN_SECONDS,
    group: SESSION_GROUP,
    setHere: false,
    offered: "",
    capSeconds: null,
  },
  {
    id: "step-up",
    label: "Step-up window",
    seconds: stepUpSeconds.value,
    group: CLOCK_GROUP_LABELS.challenge,
    setHere: false,
    offered: "",
    capSeconds: null,
  },
  ...FIXED_CLOCKS.map((clock) => ({
    id: clock.id,
    label: clock.label,
    seconds: clock.seconds,
    group: CLOCK_GROUP_LABELS[clock.group],
    setHere: false,
    offered: "",
    capSeconds: clock.capSeconds,
  })),
]);

function offeredFrom(choices: readonly number[]): string {
  const { minSeconds, maxSeconds } = choiceRange(choices);
  return rangeWords(minSeconds, maxSeconds);
}

/*
 * The columns. Shortest first is the default sort rather than the row order, because the
 * order a reader leaves the table in is theirs: it is the one question this card answers
 * that the cards either side of it cannot, and it is still only a click away once they
 * have sorted by anything else.
 *
 * What sets a clock is its own column instead of a mark on the name, because it is the
 * thing a reader filters the table down to. The cap is off until somebody turns it on:
 * it is the answer to a question asked second, and only the fixed rows have one.
 */
const CLOCK_COLUMNS: readonly DataTableColumn<ClockRow>[] = [
  { key: "label", title: "Clock", fixed: true, minWidth: 220 },
  { key: "seconds", title: "Length", width: 120, mono: true },
  { key: "setHere", title: "Set by", width: 140, value: (row) => (row.setHere ? 0 : 1) },
  { key: "offered", title: "This screen offers", width: 170 },
  { key: "group", title: "Where it is used", width: 220 },
  {
    key: "capSeconds",
    title: "Most allowed",
    width: 140,
    mono: true,
    hidden: true,
    value: (row) => (row.capSeconds === null ? "" : shortDuration(row.capSeconds)),
  },
];

const storedColumns = useLocalStorage<ColumnState>(
  "idenzy.lifetimes.columns",
  defaultColumnState(CLOCK_COLUMNS),
);
const clockColumnState = computed<ColumnState>({
  get: () => reconcileColumnState(CLOCK_COLUMNS, storedColumns.value),
  set: (value) => {
    storedColumns.value = value;
  },
});

const clockSort = ref<DataTableSort[]>([{ key: "seconds", order: "asc" }]);

/** What a fixed row says under its length: why it is that length, then where the cap is. */
function capNote(capSeconds: number | null): string {
  return capSeconds === null
    ? "Set for the deployment, with no cap in the schema."
    : `Set for the deployment, which may not raise it past ${humanizeSeconds(capSeconds)}.`;
}

/*
 * The figures, read off the sessions the panel already holds rather than invented beside
 * them. What ends a session is exactly what this screen configures, so a breakdown that
 * disagreed with the sessions list would be the first thing anybody noticed.
 *
 * Two tiles and not four: how many of each clock ended is in the breakdown underneath,
 * and a tile repeating a bar's figure is a second place for the two to disagree.
 */
const rows = computed(() => sessions.forProject(projects.current.id));

const live = computed(() => rows.value.filter((row) => sessionStatus(row, now.value) === "active"));

const lapsingSoon = computed(() => {
  const horizon = now.value.getTime() + 7 * DURATIONS.DAY;
  return live.value.filter((row) => new Date(endsAt(row).at).getTime() <= horizon).length;
});

/**
 * Every reason anything ended, most common first, so the two clocks are read in context:
 * a project where nothing lapses is one where these settings decide nothing.
 */
const endings = computed(() => {
  const counts = new Map<RevokeReason, number>();
  for (const row of rows.value) {
    const reason = endedBy(row, now.value);
    if (reason !== null) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
});

const LAPSE_REASONS: readonly RevokeReason[] = ["idle_timeout", "absolute_timeout"];

const endedTotal = computed(() => endings.value.reduce((total, entry) => total + entry.count, 0));

const lapsedShare = computed(() => {
  if (endedTotal.value === 0) return 0;
  const lapsed = endings.value
    .filter((entry) => LAPSE_REASONS.includes(entry.reason))
    .reduce((sum, entry) => sum + entry.count, 0);
  return Math.round((lapsed / endedTotal.value) * 100);
});

const share = (count: number) =>
  endedTotal.value === 0 ? 0 : Math.round((count / endedTotal.value) * 100);

const saving = computed(() => busy.value.size > 0);
const lastSaved = computed(() => store.lastSavedAt(projects.current.id));

const GUIDES = [
  {
    icon: "material-symbols:timer-outline",
    title: "Lifetimes, end to end",
    detail: "The three you set, the ones we fix, and what each is measured from.",
    href: "https://idenzy.dev/docs/tokens/lifetimes",
  },
  {
    icon: "material-symbols:block",
    title: "The revocation set",
    detail: "RevocationCache, the secret key it needs, and what it fails open to.",
    href: "https://idenzy.dev/docs/tokens/revocation",
  },
  {
    icon: "material-symbols:verified-user-outline",
    title: "Verifying offline",
    detail: "AccessTokenVerifier in @idenzy/node, and why aud is required.",
    href: "https://idenzy.dev/docs/sdk/node/verify",
  },
  {
    icon: "material-symbols:sync",
    title: "Refresh and rotation",
    detail: "Single-flight, the cross-tab lock, and why a refresh is never retried.",
    href: "https://idenzy.dev/docs/sdk/js/refresh",
  },
];
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:timer-outline" title="Lifetimes">
      <template #description>
        How long each credential
        <span class="font-medium text-ink">{{ projects.current.name }}</span> issues stays
        usable. Three numbers you decide, the rest the deployment fixes, and what each one
        costs. Changes save as you make them.
      </template>
    </PageHeader>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <div class="flex min-w-0 flex-col gap-6">
        <LayerCard
          v-model:open="expanded.token"
          :padded="false"
          description="The one number paid for in three places at once. Everything under it is worked out from the lifetime chosen here."
          expandable
          title="The access token"
        >
          <template #badge>
            <StatusBadge :label="tokenLabel" tone="neutral" />
          </template>

          <div class="px-5 pt-5 pb-4">
            <SettingRow label="Lifetime">
              <template #description>
                How long a minted token verifies. Your own server checks it offline against
                a cached key set, so a page rendered for a signed-in user costs no round
                trip; the price of that is the window below, in which a session already
                revoked still passes. The server takes {{ floorLabel }} to
                {{ ceilingLabel }} and nothing outside: under a minute the refresh traffic
                stops paying for itself, over an hour the revocation latency stops being
                defensible.
              </template>
              <SegmentedControl
                v-model="accessToken"
                :disabled="isBusy('accessToken') || store.loading"
                :options="ACCESS_TOKEN_OPTIONS"
                label="Access token lifetime"
              />
            </SettingRow>
          </div>

          <!-- The consequences, under the control that decides them rather than in a
               paragraph elsewhere. All three move as the segments do. -->
          <div class="grid gap-5 border-y border-line bg-canvas/60 px-5 py-4 sm:grid-cols-3">
            <LifetimeOutcome
              :note="`One active user, at the ${activeHours} hours of use a month we price on.`"
              :value="refreshes.toLocaleString('en')"
              label="Refreshes"
              unit="a month"
            />
            <LifetimeOutcome
              :note="
                polling
                  ? `Your verifier last read the published set ${polledAgo}, so a revocation lands within one poll.`
                  : 'Nothing has read this project\'s revocation set, so a revoked session is refused only once its token expires.'
              "
              :tone="polling ? 'primary' : 'warning'"
              :unit="`${durationParts(revocationWindow).unit}, worst case`"
              :value="durationParts(revocationWindow).digits"
              label="A revocation is seen in"
            />
            <LifetimeOutcome
              :note="`One lifetime, whatever the set holds: a suspension is not a revocation, so nothing is published and the account stops at its next rotation.`"
              :unit="durationParts(saved.accessTokenSeconds).unit"
              :value="durationParts(saved.accessTokenSeconds).digits"
              label="A suspension takes effect in"
            />
          </div>

          <div class="divide-y divide-line px-5 py-5">
            <SettingRow
              :fixed="polling ? 'Polled' : 'Not polled'"
              label="The revocation set"
            >
              <template #description>
                <template v-if="polling">
                  Something holding this project's secret key is polling the published
                  snapshot and checking an in-process copy, which costs your request path a
                  hash lookup and no network call. It last read the set
                  {{ polledAgo }}, every {{ REVOCATION_POLL_SECONDS }} seconds by default,
                  and the snapshot carries what was revoked in the last
                  {{ humanizeSeconds(retention) }}: one token lifetime plus a minute of
                  skew, which is the bound that keeps it small enough to publish whole.
                </template>
                <template v-else>
                  Nothing has ever fetched this project's snapshot, so the lifetime above is
                  the whole revocation window. Attaching a
                  <span class="font-mono text-ink/80">RevocationCache</span> to your
                  verifier closes it to one poll without giving up offline verification, and
                  it changes the answer rather than the shape of it: a backend that builds
                  none keeps a package whose only outbound call is for the key set.
                </template>
              </template>
            </SettingRow>
            <SettingRow
              description="Our own endpoints read the session row on every authenticated request, so revoking one takes effect immediately there whatever the lifetime says. The window above is your verifier's, and it exists because offline verification is the thing that makes a server-rendered page free."
              fixed="Immediate"
              label="On our own API"
            />
            <SettingRow
              description="The __Host-idenzy-session cookie is written with this lifetime as its max age, so the cookie and the token it carries die together. A browser holding a cookie past the token inside it would send a credential every request that nothing can accept."
              fixed="The same"
              label="The session cookie"
            />
            <SettingRow label="What it does not change">
              <template #description>
                The claims a token carries. Which fields it publishes beyond the ones we
                assemble is a
                <NuxtLink
                  class="font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
                  to="/tokens/claims"
                  >claim template</NuxtLink
                >, and
                <span class="font-mono text-ink/80">exp</span> is reserved: a template
                cannot move it, because a claim that undoes the check every verifier makes
                is not a claim anybody should be able to write.
              </template>
            </SettingRow>
          </div>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.session"
          :padded="false"
          description="Two clocks, and they constrain each other. Whichever falls first is what ends a session."
          expandable
          title="The session"
        >
          <template #badge>
            <StatusBadge :label="`Ends after ${humanizeSeconds(untouched.seconds)}`" tone="neutral" />
          </template>

          <div class="divide-y divide-line px-5 pt-5 pb-4">
            <SettingRow label="How long it may sit untouched">
              <template #description>
                The idle window, and it slides forward on every rotation. Idle means no
                rotation rather than no activity: a client that never asks for a token never
                touches the clock, however busy your own server has been on its behalf.
              </template>
              <SegmentedControl
                v-model="idle"
                :disabled="isBusy('idle') || store.loading"
                :options="idleOptions"
                label="Idle timeout"
              />
            </SettingRow>
            <SettingRow label="The most it may ever last">
              <template #description>
                Set at sign-in and never moved again, which is what bounds the damage from a
                session an attacker keeps warm by using it. A window longer than this one
                could never fire, so the idle control above is not offered it.
              </template>
              <SegmentedControl
                v-model="absolute"
                :disabled="isBusy('absolute') || store.loading"
                :options="absoluteOptions"
                label="Maximum lifetime"
              />
            </SettingRow>
          </div>

          <div class="grid gap-5 border-y border-line bg-canvas/60 px-5 py-4 sm:grid-cols-2">
            <LifetimeOutcome
              :note="`Nobody comes back to it, so it ends on ${SESSION_CLOCK_LABELS[untouched.clock]}.`"
              :unit="durationParts(untouched.seconds).unit"
              :value="durationParts(untouched.seconds).digits"
              label="Left alone, a session ends after"
            />
            <LifetimeOutcome
              :note="`Every other clock slides forward on a rotation, so this is the one a session in daily use cannot get past.`"
              :unit="durationParts(heldOpen.seconds).unit"
              :value="durationParts(heldOpen.seconds).digits"
              label="Used every day, it ends after"
            />
          </div>

          <div class="divide-y divide-line px-5 py-5">
            <SettingRow
              :description="`Reissued with its own ${shortDuration(REFRESH_TOKEN_SECONDS)} on every rotation, so it is a backstop rather than the clock that usually decides. Where it is shorter than the idle window it becomes the one that ends the session, which is why the figure above names whichever of the three falls first.`"
              :fixed="shortDuration(REFRESH_TOKEN_SECONDS)"
              label="The refresh token"
            />
            <SettingRow
              description="Rotated on every use, and presenting one already rotated revokes the whole family and the session with it. That is why nothing ever retries a refresh: a rotation whose response was not observed is an unknown state, and sending it again turns it into a certain sign-out."
              fixed="Every use"
              label="Rotation"
            />
            <SettingRow
              description="The idle window is written at the next rotation, so a change here reaches a live session within one access-token lifetime. The maximum lifetime is not: it was set when the session was created and nothing moves it, so shortening it governs sessions signed in from now on and leaves the ones that exist where they are."
              fixed="Next rotation"
              label="When a change reaches a live session"
            />
            <SettingRow
              description="A session ends by a clock or by somebody acting, and the two are told apart by the reason written on the row rather than by which column holds a timestamp. A sweeper marking one idle must not move it out of the expired list and into the revoked one: nothing about what ended it changed, only who wrote it down."
              fixed="The reason"
              label="How an ending is recorded"
            />
          </div>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.lengths"
          :padded="false"
          description="Every lifetime in the project in one table, shortest first. Three of them this screen sets and the rest are fixed for the deployment."
          expandable
          title="Every clock"
        >
          <template #actions>
            <DataTableColumnsMenu v-model="clockColumnState" :columns="CLOCK_COLUMNS" />
          </template>

          <!-- Unpaged: the set is every clock the product has, and a foot saying
               "1-14 of 14" under it is a control with nothing to do. -->
          <DataTable
            v-model:column-state="clockColumnState"
            v-model:sort-by="clockSort"
            :columns="CLOCK_COLUMNS"
            :items="clockRows"
            :paged="false"
            item-value="id"
            label="Lifetimes"
          >
            <template #cell.label="{ item }">
              <span :class="item.setHere ? 'font-medium text-ink' : 'text-ink'" class="truncate">
                {{ item.label }}
              </span>
            </template>

            <!-- Digits in the mono face and the unit beside it in the body face: a mono
                 space is as wide as a digit, so "14 d" set as one run has a hole in it. -->
            <template #cell.seconds="{ item }">
              <span class="whitespace-nowrap">
                <span class="font-mono tabular-nums">
                  {{ shortDurationParts(item.seconds).digits }}
                </span>
                <span class="pl-1 text-ink/55">{{ shortDurationParts(item.seconds).unit }}</span>
              </span>
            </template>

            <template #cell.setHere="{ item }">
              <span :class="item.setHere ? 'text-ink' : 'text-ink/55'">
                {{ item.setHere ? "This screen" : "The deployment" }}
              </span>
            </template>

            <template #cell.offered="{ item }">
              <span v-if="item.offered" class="whitespace-nowrap text-ink/70">
                {{ item.offered }}
              </span>
              <span v-else class="text-ink/35">–</span>
            </template>

            <template #cell.group="{ item }">
              <span class="truncate text-ink/70">{{ item.group }}</span>
            </template>
          </DataTable>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.waiting"
          description="How long we wait for somebody to answer. Each is short because what is waiting is a credential, and long enough for the thing the person actually has to do."
          expandable
          title="Waiting on a person"
        >
          <div class="divide-y divide-line">
            <SettingRow
              v-for="clock in clocksIn('challenge')"
              :key="clock.id"
              :fixed="shortDuration(clock.seconds)"
              :label="clock.label"
            >
              <template #description>
                {{ clock.note }} {{ capNote(clock.capSeconds) }}
              </template>
            </SettingRow>
            <SettingRow label="Step-up window">
              <template #description>
                How recent a second-factor proof has to be before a sensitive action goes
                ahead. Not a lifetime but a freshness rule, and the one clock on this screen
                set somewhere else:
                <NuxtLink
                  class="font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
                  to="/mfa/step-up"
                  >the step-up screen</NuxtLink
                >
                owns it, and this screen reads it from there so the two cannot disagree.
              </template>
              <template #actions>
                <span
                  class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55"
                >
                  {{ shortDuration(stepUpSeconds) }}
                </span>
              </template>
            </SettingRow>
          </div>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.mail"
          description="A code passed between two of our own steps, and a link that has to survive a mailbox. The two ends of the range, and for opposite reasons."
          expandable
          title="Handoffs and mail"
        >
          <div class="divide-y divide-line">
            <SettingRow
              v-for="clock in [...clocksIn('handoff'), ...clocksIn('mail')]"
              :key="clock.id"
              :fixed="shortDuration(clock.seconds)"
              :label="clock.label"
            >
              <template #description>
                {{ clock.note }} {{ capNote(clock.capSeconds) }}
              </template>
            </SettingRow>
          </div>
        </LayerCard>
      </div>

      <aside class="flex flex-col gap-4 xl:sticky xl:top-20">
        <div class="flex items-baseline justify-between px-1">
          <h2 class="m-0 text-base font-semibold tracking-tight text-ink">Sessions</h2>
          <span class="text-xs text-ink/55">On this project</span>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <UsageTile
            :value="live.length"
            :seed="31"
            info="Sessions on this project that are neither revoked nor past one of their two expiries."
            label="Live now"
          />
          <UsageTile
            :value="lapsingSoon"
            :seed="37"
            info="Live sessions whose earlier expiry falls inside the next seven days, under the settings on this screen."
            label="Lapsing in 7 days"
          />
        </div>

        <LayerCard
          :padded="false"
          description="Whether these clocks are what ends anything here, or whether people sign out first."
          title="How sessions ended"
        >
          <!-- The label sits over its own bar rather than beside it: "Signed out
               everywhere" and "Refresh token reuse" both lose the word that tells them
               apart in a fixed column this narrow. -->
          <ul v-if="endedTotal > 0" class="m-0 flex list-none flex-col gap-3 p-4 text-xs">
            <li v-for="entry in endings" :key="entry.reason" class="flex flex-col gap-1">
              <div class="flex items-baseline justify-between gap-3">
                <span
                  :class="LAPSE_REASONS.includes(entry.reason) ? 'text-ink' : 'text-ink/70'"
                  class="min-w-0 truncate"
                >
                  {{ REASON_LABELS[entry.reason] }}
                </span>
                <span class="flex-none font-mono text-[11px] text-ink tabular-nums">
                  {{ entry.count.toLocaleString("en") }}
                </span>
              </div>
              <span class="block h-1.5 w-full overflow-hidden rounded-full bg-ink/8">
                <span
                  :class="LAPSE_REASONS.includes(entry.reason) ? 'bg-primary' : 'bg-ink/25'"
                  :style="{ width: `${share(entry.count)}%` }"
                  class="block h-full rounded-full"
                />
              </span>
            </li>
          </ul>
          <p v-else class="m-0 px-4 py-6 text-center text-xs text-ink/50">
            Nothing has ended on this project yet.
          </p>
          <div
            v-if="endedTotal > 0"
            class="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[11px] text-ink/55"
          >
            <span>
              <span class="font-mono text-ink tabular-nums">{{ lapsedShare }}%</span> ended
              because a clock ran out
            </span>
            <v-tooltip
              location="top"
              max-width="260"
              text="The idle timeout and the maximum lifetime, against everything somebody did: a sign-out, a password change, a revocation from here, a reused refresh token."
            >
              <template #activator="{ props: tip }">
                <Icon
                  v-bind="tip"
                  aria-label="What the share counts"
                  class="flex-none text-sm text-ink/40"
                  name="material-symbols:info-outline"
                  role="img"
                />
              </template>
            </v-tooltip>
          </div>
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

        <SaveStatus :last-saved="lastSaved" :saving="saving" />
      </aside>
    </div>
  </div>
</template>

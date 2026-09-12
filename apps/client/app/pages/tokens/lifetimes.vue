<script setup lang="ts">
/**
 * How long each credential this project issues stays usable (PROJECT.md 4.2,
 * packages/config/src/schema.ts), arranged the way `notes/tokens-lifetimes.md` asks: the
 * three numbers a project decides, in one group, with their combined outcome above the
 * button that saves them, and every other clock in the product as a reference table that
 * links to whoever owns it.
 *
 * The three are one policy and not three settings, which is why this screen saves as a
 * group where the passwords and one-time-code screens save on the spot. The idle window
 * and the maximum lifetime constrain each other, the access-token lifetime decides what
 * the other two cost, and the question a reader is actually asking is what the three
 * together do to a session. A control that wrote itself would answer that question three
 * times, once per keystroke, from a policy that was never all there at once.
 *
 * What saving does is not the same for the three, and the review above the button says so
 * per field. An idle window is read at the next rotation, so it reaches sessions that
 * exist; a maximum lifetime is stamped at sign-in and never moved, so shortening it
 * changes nothing for anybody already signed in. A screen that said only "saved" would
 * leave an operator believing they had just shortened sessions they had not touched.
 *
 * The revocation window is the one figure here the panel can only observe. Whether a
 * revoked session dies in seconds or waits out its token is whether something holding
 * this project's secret key polls the published snapshot (ADR-0009), and what the panel
 * has seen is one integration doing it, never proof that every verifier does. The card
 * says exactly that much.
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
  type ClockRow,
  clockRows,
  durationChoices,
  durationParts,
  IDLE_CHOICES,
  isAbsoluteOffered,
  isIdleOffered,
  isPolicyValid,
  type LifetimeSettings,
  policyChanges,
  policySummary,
  REFRESH_TOKEN_SECONDS,
  REVOCATION_POLL_SECONDS,
  REVOCATION_SKEW_SECONDS,
  refreshesPerActiveUser,
  revocationWindowSeconds,
  SESSION_GROUP,
  sessionTimeline,
  shortDuration,
  shortDurationParts,
  snapshotRetentionSeconds,
} from "~/utils/lifetimes";
import { humanizeSeconds } from "~/utils/otp";
import { endedBy, type RevokeReason } from "~/utils/sessions";
import { relativeTimeWords } from "~/utils/time";

const projects = useProjectStore();
const store = useLifetimesStore();
const mfa = useMfaStore();
const passwords = usePasswordPolicyStore();
const sessions = useSessionsStore();

const saved = computed<LifetimeSettings>(() => store.settingsFor(projects.current.id));
const now = useNow({ interval: 60_000 });

/*
 * The draft, one per project, seeded from what is saved once the settings have loaded.
 * Held per project so switching projects and back does not lose an edit, and so a draft
 * can never be written into a project it was not made for.
 */
const drafts = ref<Record<string, LifetimeSettings>>({});

watch(
  [() => projects.current.id, () => store.loading],
  ([projectId, loading]) => {
    if (loading || drafts.value[projectId] !== undefined) return;
    drafts.value = { ...drafts.value, [projectId]: { ...store.settingsFor(projectId) } };
  },
  { immediate: true },
);

const draft = computed<LifetimeSettings>(
  () => drafts.value[projects.current.id] ?? { ...saved.value },
);

function edit(change: Partial<LifetimeSettings>) {
  const projectId = projects.current.id;
  const current = drafts.value[projectId] ?? { ...saved.value };
  drafts.value = { ...drafts.value, [projectId]: { ...current, ...change } };
}

/** Each control hands back a string and stores a number, and writes only the draft. */
function control(read: () => number, write: (value: number) => Partial<LifetimeSettings>) {
  return computed({
    get: () => String(read()),
    set: (value: string) => {
      const next = Number(value);
      if (!Number.isFinite(next) || next === read()) return;
      edit(write(next));
    },
  });
}

const accessToken = control(
  () => draft.value.accessTokenSeconds,
  (accessTokenSeconds) => ({ accessTokenSeconds }),
);
const idle = control(
  () => draft.value.idleSeconds,
  (idleSeconds) => ({ idleSeconds }),
);
const absolute = control(
  () => draft.value.absoluteSeconds,
  (absoluteSeconds) => ({ absoluteSeconds }),
);

const ACCESS_TOKEN_OPTIONS = durationChoices(ACCESS_TOKEN_CHOICES);

/*
 * The two session clocks constrain each other, and the combination that could never fire
 * is not offered rather than saved and quietly ignored. The reason is written beside the
 * control instead of left inside a disabled segment: a control that refuses without
 * saying why is a puzzle, whichever way it refuses.
 */
const idleOptions = computed(() =>
  durationChoices(IDLE_CHOICES).map((choice) => ({
    ...choice,
    disabled: !isIdleOffered(Number(choice.value), draft.value.absoluteSeconds),
  })),
);

const absoluteOptions = computed(() =>
  durationChoices(ABSOLUTE_CHOICES).map((choice) => ({
    ...choice,
    disabled: !isAbsoluteOffered(Number(choice.value), draft.value.idleSeconds),
  })),
);

const idleCapped = computed(() =>
  IDLE_CHOICES.some((seconds) => !isIdleOffered(seconds, draft.value.absoluteSeconds)),
);
const absoluteFloored = computed(() =>
  ABSOLUTE_CHOICES.some((seconds) => !isAbsoluteOffered(seconds, draft.value.idleSeconds)),
);

/*
 * What the access-token lifetime costs. Whether a revocation is seen in seconds or waited
 * out is not a setting: it is whether anything holding this project's secret key has ever
 * fetched the snapshot, which the panel observes and cannot change.
 */
const polledAt = computed(() => store.revocationPolledAt(projects.current.id));
const polling = computed(() => polledAt.value !== null);

const polledAgo = computed(() => {
  const at = polledAt.value;
  if (at === null) return "";
  const stamp = new Date(at);
  return relativeTimeWords(at, now.value < stamp ? stamp : now.value);
});

const refreshes = computed(() => refreshesPerActiveUser(draft.value.accessTokenSeconds));
const revocationWindow = computed(() =>
  revocationWindowSeconds(draft.value.accessTokenSeconds, polling.value),
);
const retention = computed(() => snapshotRetentionSeconds(draft.value.accessTokenSeconds));

const floorLabel = humanizeSeconds(ACCESS_TOKEN_FLOOR_SECONDS);
const ceilingLabel = humanizeSeconds(ACCESS_TOKEN_CEILING_SECONDS);
const activeHours = ACTIVE_SECONDS_PER_MONTH / 3600;

const timeline = computed(() => sessionTimeline(draft.value));

/*
 * Saving. One write for the three, because they are one policy: a pair saved halfway is a
 * policy nobody chose, and the server checks the pair rather than either half.
 */
const changes = computed(() => policyChanges(saved.value, draft.value));
const dirty = computed(() => changes.value.length > 0);
const valid = computed(() => isPolicyValid(draft.value));
const saving = ref(false);
const canSave = computed(() => dirty.value && valid.value && !saving.value && !store.loading);

async function save() {
  if (!canSave.value) return;
  const projectId = projects.current.id;
  const policy = { ...draft.value };
  saving.value = true;
  try {
    await store.patch(projectId, policy);
    drafts.value = { ...drafts.value, [projectId]: policy };
  } finally {
    saving.value = false;
  }
}

function cancel() {
  drafts.value = { ...drafts.value, [projects.current.id]: { ...saved.value } };
}

const lastSaved = computed(() => store.lastSavedAt(projects.current.id));

/*
 * The reference table. Every clock in the product, each read from whatever owns it: the
 * step-up window from the MFA store and the password-reset link from the password policy,
 * because both have screens that offer a control and a stale copy here would be this
 * screen contradicting them.
 */
const stepUpSeconds = computed(() => mfa.stepUpFor(projects.current.id).maxAgeMinutes * 60);
const passwordResetSeconds = computed(
  () => passwords.policyFor(projects.current.id).resetLifetime * 60,
);

const rows = computed<ClockRow[]>(() =>
  clockRows({
    settings: saved.value,
    stepUpSeconds: stepUpSeconds.value,
    passwordResetSeconds: passwordResetSeconds.value,
  }),
);

const CLOCK_COLUMNS: readonly DataTableColumn<ClockRow>[] = [
  { key: "label", title: "Clock", fixed: true, minWidth: 200 },
  { key: "seconds", title: "Value", width: 110, mono: true },
  { key: "owner", title: "Managed on", width: 190, value: (row) => ownerLabel(row) },
  { key: "group", title: "Where it is used", width: 200 },
  {
    key: "capSeconds",
    title: "Most allowed",
    width: 130,
    mono: true,
    hidden: true,
    value: (row) => (row.capSeconds === null ? "" : shortDuration(row.capSeconds)),
  },
];

/** Written out rather than inferred in the template, so sorting and the cell agree. */
function ownerLabel(row: ClockRow): string {
  if (row.here) return "This screen";
  return row.owner?.label ?? "The deployment";
}

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

/*
 * The one piece of evidence this screen can offer about whether these clocks decide
 * anything: what actually ended the sessions the panel already holds. Read off the
 * sessions store rather than invented, so this screen and the sessions list cannot
 * disagree about what ended what.
 */
const LAPSE_REASONS: readonly RevokeReason[] = ["idle_timeout", "absolute_timeout"];

const endings = computed(() => {
  const counts = new Map<RevokeReason, number>();
  for (const row of sessions.forProject(projects.current.id)) {
    const reason = endedBy(row, now.value);
    if (reason !== null) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return counts;
});

const endedTotal = computed(() => [...endings.value.values()].reduce((sum, n) => sum + n, 0));

const lapsedCount = computed(() =>
  LAPSE_REASONS.reduce((sum, reason) => sum + (endings.value.get(reason) ?? 0), 0),
);

const lapsedShare = computed(() =>
  endedTotal.value === 0 ? 0 : Math.round((lapsedCount.value / endedTotal.value) * 100),
);

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
    <PageHeader title="Token and session lifetimes">
      <template #badge>
        <v-tooltip
          v-if="!store.loading"
          location="bottom"
          text="Access token · idle timeout · maximum lifetime, as they are saved right now."
        >
          <template #activator="{ props: tip }">
            <span v-bind="tip">
              <StatusBadge :label="policySummary(saved)" tone="neutral" />
            </span>
          </template>
        </v-tooltip>
      </template>
      <template #description>
        How long each credential
        <span class="font-medium text-ink">{{ projects.current.name }}</span> issues stays
        usable, and the trade the three below are: a longer token is fewer requests and a
        wider window in which a revoked session still passes.
      </template>
    </PageHeader>

    <!--
      One card for the whole policy, because the three are one decision. The order inside
      it changes with the viewport: from `lg` the timeline sits between the outcomes and
      the two session controls, and below it the controls come first and the timeline
      turns vertical underneath them. Ordered with `order`, so the DOM keeps the reading
      order and nothing focusable moves.
    -->
    <LayerCard
      :padded="false"
      description="The three numbers this project decides. Everything below them is worked out from what is selected here, not from what is saved."
      title="Session policy"
    >
      <template #badge>
        <StatusBadge
          v-if="dirty && !store.loading"
          :label="changes.length === 1 ? '1 unsaved change' : `${changes.length} unsaved changes`"
          tone="warning"
        />
      </template>

      <p v-if="store.loading" class="m-0 px-4 py-10 text-center text-xs text-ink/50">
        Reading the policy.
      </p>

      <div v-else class="flex flex-col">
        <!-- 1. The access token. -->
        <div class="order-1 flex flex-col gap-3 px-5 pt-5 pb-4">
          <SettingRow label="Access token">
            <template #description>
              How long a minted token verifies. Your own server checks it offline against a
              cached key set, so a page rendered for a signed-in user costs no round trip;
              the price of that is the window beside, in which a session already revoked
              still passes. The server takes {{ floorLabel }} to {{ ceilingLabel }} and
              nothing outside.
            </template>
            <SegmentedControl
              v-model="accessToken"
              :options="ACCESS_TOKEN_OPTIONS"
              label="Access token lifetime"
            />
          </SettingRow>
        </div>

        <!-- 2. What that lifetime costs, in the two directions it costs anything. -->
        <div class="order-2 grid gap-5 border-y border-line bg-ink/3 px-5 py-4 lg:grid-cols-2">
          <div class="flex min-w-0 flex-col gap-2">
            <LifetimeOutcome
              :note="
                polling
                  ? `A verifier holding this project's secret key read the published set ${polledAgo}, so a revocation it sees lands within one poll.`
                  : 'Nothing has read this project\'s revocation set, so a revoked session keeps passing at your verifier until its token expires.'
              "
              :tone="polling ? 'primary' : 'warning'"
              :unit="`${durationParts(revocationWindow).unit}, worst case`"
              :value="durationParts(revocationWindow).digits"
              label="A revoked token keeps working for"
            />
            <!--
              What the panel saw is one integration polling. It is not a statement about
              every verifier a customer runs, and a page that rounded it up to one would
              be selling a guarantee out of a single observation.
            -->
            <p
              :class="polling ? 'text-ink/55' : 'text-warning'"
              class="m-0 flex items-start gap-1.5 text-[11px] leading-4"
            >
              <Icon
                :name="
                  polling ? 'material-symbols:info-outline' : 'material-symbols:warning-outline'
                "
                aria-hidden="true"
                class="mt-px flex-none text-sm"
              />
              <span v-if="polling">
                Observed for one integration, which is all this panel can see. Any verifier of
                yours that holds no
                <span class="font-mono text-ink/75">RevocationCache</span> still waits out the
                full {{ humanizeSeconds(draft.accessTokenSeconds) }}.
              </span>
              <span v-else>
                Our own API reads the session row on every request, so revoking one takes
                effect there immediately. This window is your verifier's.
              </span>
            </p>
            <NuxtLink
              class="w-fit text-[11px] font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
              to="/tokens/revocation"
            >
              Open revocation setup
            </NuxtLink>
          </div>

          <div class="flex min-w-0 flex-col gap-2">
            <LifetimeOutcome
              :note="`At ${activeHours} hours of active use a month, which is what PROJECT.md prices the platform on.`"
              :value="refreshes.toLocaleString('en')"
              label="Refreshes per active user"
              unit="a month"
            />
            <p class="m-0 flex items-start gap-1.5 text-[11px] leading-4 text-ink/55">
              <Icon
                aria-hidden="true"
                class="mt-px flex-none text-sm"
                name="material-symbols:info-outline"
              />
              <span>
                An estimate, not a bill. It assumes a client that refreshes only when a token
                expires under active use, which is what
                <span class="font-mono text-ink/75">@idenzy/js</span> does: renewal is lazy and
                never on a timer. The full assumptions are at the foot of this page.
              </span>
            </p>
          </div>
        </div>

        <!-- 3 on desktop, 4 on mobile: the line the two controls below actually move. -->
        <div class="order-4 border-b border-line px-5 py-5 lg:order-3">
          <SessionTimeline :draft="dirty" :stops="timeline" />
          <p v-if="endedTotal > 0" class="m-0 mt-4 text-[11px] leading-4 text-ink/55">
            Of the {{ endedTotal }} sessions that have ended on this project,
            <span class="font-medium text-ink">{{ lapsedShare }}%</span> ended on one of these
            clocks rather than because somebody signed out or a session was revoked.
          </p>
        </div>

        <!-- 4 on desktop, 3 on mobile: the pair. -->
        <div class="order-3 divide-y divide-line px-5 py-1 lg:order-4">
          <SettingRow label="Idle timeout">
            <template #description>
              How long a session may sit untouched. Idle means no rotation rather than no
              activity: a client that never asks for a token never touches this clock,
              however busy your own server has been on its behalf.
              <span v-if="idleCapped" class="text-ink/75">
                Windows past the maximum lifetime are not offered, because one longer than
                the deadline it sits inside could never fire.
              </span>
            </template>
            <SegmentedControl v-model="idle" :options="idleOptions" label="Idle timeout" />
          </SettingRow>
          <SettingRow label="Maximum lifetime">
            <template #description>
              Stamped at sign-in and never moved again, which is what bounds the damage from
              a session an attacker keeps warm by using it.
              <span v-if="absoluteFloored" class="text-ink/75">
                Deadlines shorter than the idle window are not offered, for the same reason
                from the other end.
              </span>
            </template>
            <SegmentedControl
              v-model="absolute"
              :options="absoluteOptions"
              label="Maximum lifetime"
            />
          </SettingRow>
        </div>

        <!-- 5. What saving would do, per field, before the button that does it. -->
        <div
          class="order-5 flex flex-col gap-4 border-t border-line bg-ink/3 px-5 py-4 lg:flex-row lg:items-end lg:justify-between"
        >
          <div class="flex min-w-0 flex-col gap-2">
            <h3 class="m-0 text-xs font-medium text-ink">
              {{ dirty ? "What saving changes" : "Nothing to save" }}
            </h3>

            <ul v-if="dirty" class="m-0 flex list-none flex-col gap-2 p-0">
              <li
                v-for="change in changes"
                :key="change.field"
                class="flex items-start gap-2 text-[11px] leading-4"
              >
                <Icon
                  :class="change.direction === 'shorter' ? 'text-warning' : 'text-ink/45'"
                  :name="
                    change.direction === 'shorter'
                      ? 'material-symbols:arrow-downward'
                      : 'material-symbols:arrow-upward'
                  "
                  aria-hidden="true"
                  class="mt-px flex-none text-sm"
                />
                <span class="min-w-0 text-ink/70">
                  <span class="font-medium text-ink">{{ change.label }}</span>
                  <span class="font-mono text-ink/45 line-through">{{
                    shortDuration(change.fromSeconds)
                  }}</span>
                  <span aria-hidden="true" class="text-ink/35">&rarr;</span>
                  <span class="font-mono font-medium text-ink">{{
                    shortDuration(change.toSeconds)
                  }}</span>
                  &middot; {{ change.appliesTo }}
                </span>
              </li>
            </ul>
            <p v-else class="m-0 text-[11px] leading-4 text-ink/55">
              The controls above are the policy in force. Tokens already issued keep the
              lifetime they were minted with either way.
            </p>

            <SaveStatus v-if="!dirty" :last-saved="lastSaved" :saving="saving" />
          </div>

          <div class="flex flex-none items-center gap-2 lg:justify-end">
            <v-btn
              v-if="dirty && !saving"
              class="text-xs font-medium"
              color="neutral"
              size="small"
              variant="text"
              @click="cancel"
            >
              Cancel changes
            </v-btn>
            <FancyButton :disabled="!canSave" @click="save">
              <Icon
                :class="saving ? 'animate-spin' : ''"
                :name="
                  saving ? 'material-symbols:progress-activity' : 'material-symbols:save-outline'
                "
                aria-hidden="true"
                class="text-sm"
              />
              Save policy
            </FancyButton>
          </div>
        </div>
      </div>
    </LayerCard>

    <!--
      Every other clock in the product. Each row states where it is decided and, where that
      is a screen of ours, sends the reader there: a fixed value drawn as a disabled input
      is a control that lies about being one.
    -->
    <LayerCard
      :padded="false"
      description="Every lifetime the product has, shortest first. Three of them are set above, two are set on another screen of ours, and the rest are fixed for the deployment."
      title="Other credential clocks"
    >
      <template #actions>
        <DataTableColumnsMenu v-model="clockColumnState" :columns="CLOCK_COLUMNS" />
      </template>

      <!-- Unpaged: this is every clock the product has, and a foot saying "1-13 of 13"
           under it is a control with nothing to do. -->
      <DataTable
        v-model:column-state="clockColumnState"
        v-model:sort-by="clockSort"
        :columns="CLOCK_COLUMNS"
        :items="rows"
        :loading="store.loading"
        :paged="false"
        item-value="id"
        label="Lifetimes"
      >
        <template #cell.label="{ item }">
          <v-tooltip :text="item.note" location="top" max-width="360" open-delay="200">
            <template #activator="{ props: tip }">
              <span
                v-bind="tip"
                :class="item.here ? 'font-medium text-ink' : 'text-ink'"
                class="truncate"
              >
                {{ item.label }}
              </span>
            </template>
          </v-tooltip>
        </template>

        <!-- Digits in the mono face and the unit beside it in the body face: a mono space
             is as wide as a digit, so "14 d" set as one run has a hole in it. -->
        <template #cell.seconds="{ item }">
          <span class="whitespace-nowrap">
            <span class="font-mono tabular-nums">{{ shortDurationParts(item.seconds).digits }}</span>
            <span class="pl-1 text-ink/55">{{ shortDurationParts(item.seconds).unit }}</span>
          </span>
        </template>

        <template #cell.owner="{ item }">
          <NuxtLink
            v-if="item.owner"
            :to="item.owner.to"
            class="inline-flex items-center gap-1 font-medium text-ink no-underline hover:underline"
          >
            {{ item.owner.label }}
            <Icon
              aria-hidden="true"
              class="text-sm text-ink/45"
              name="material-symbols:arrow-outward"
            />
          </NuxtLink>
          <span v-else :class="item.here ? 'text-ink' : 'text-ink/55'">
            {{ item.here ? "This screen" : "The deployment" }}
          </span>
        </template>

        <template #cell.group="{ item }">
          <span :class="item.group === SESSION_GROUP ? 'text-ink/70' : 'text-ink/55'" class="truncate">
            {{ item.group }}
          </span>
        </template>
      </DataTable>
    </LayerCard>

    <LayerCard
      :open="false"
      description="What the figures above are worked out from, and the parts of this that no setting on this screen moves."
      expandable
      title="Advanced assumptions"
    >
      <div class="divide-y divide-line">
        <SettingRow
          :description="`Refreshes are ${activeHours} hours of active use a month divided by the token lifetime, which is what PROJECT.md 5 prices the platform on. A client refreshes when a token expires while somebody is still using the application; @idenzy/js renews lazily and never on a timer, because a background timer keeps a session alive in a tab nobody is looking at and turns an idle timeout into no timeout at all.`"
          :fixed="`${activeHours} h a month`"
          label="What an active user is"
        />
        <SettingRow
          :description="`With a revocation set attached, a verifier polls the published snapshot every ${REVOCATION_POLL_SECONDS} seconds by default and answers from an in-process copy, so a check costs a hash lookup and no network call. Without one, verification is offline and the token lifetime is the whole window. The figure above is whichever of the two this project is observed to be in.`"
          :fixed="`${REVOCATION_POLL_SECONDS} s poll`"
          label="How a revocation reaches a verifier"
        />
        <SettingRow
          :description="`The published set holds an entry for one access-token lifetime plus ${humanizeSeconds(REVOCATION_SKEW_SECONDS)} of skew, which is ${humanizeSeconds(retention)} at the lifetime selected above. A token minted immediately before a revocation expires one lifetime later, so nothing older can still be presented, and that bound is the only reason the set is small enough to publish whole.`"
          :fixed="humanizeSeconds(retention)"
          label="How long the snapshot holds an entry"
        />
        <SettingRow
          description="A suspension is not a revocation, so nothing is published for it and the account stops at its next rotation. That is one access-token lifetime whatever the revocation set holds."
          :fixed="humanizeSeconds(draft.accessTokenSeconds)"
          label="How long a suspended account keeps working"
        />
        <SettingRow
          :description="`Reissued with its own ${shortDuration(REFRESH_TOKEN_SECONDS)} on every rotation, and rotated on every use. Presenting one already rotated revokes the whole family and the session with it, which is why nothing ever retries a refresh: a rotation whose response was not observed is an unknown state, and sending it again turns it into a certain sign-out.`"
          :fixed="shortDuration(REFRESH_TOKEN_SECONDS)"
          label="The refresh token"
        />
        <SettingRow
          :description="`The __Host-idenzy-session cookie is written with the access token's lifetime as its max age, so the cookie and the token inside it die together. A browser holding a cookie past the token would send a credential on every request that nothing can accept.`"
          fixed="The same"
          label="The session cookie"
        />
        <SettingRow label="What none of this changes">
          <template #description>
            The claims a token carries. Which fields it publishes beyond the ones we assemble
            is a
            <NuxtLink
              class="font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
              to="/tokens/claims"
              >claim template</NuxtLink
            >, and <span class="font-mono text-ink/80">exp</span> is reserved: a template
            cannot move it, because a claim that undoes the check every verifier makes is not
            a claim anybody should be able to write.
          </template>
        </SettingRow>
      </div>

      <ul class="m-0 grid list-none gap-x-4 border-t border-line p-0 sm:grid-cols-2">
        <li v-for="guide in GUIDES" :key="guide.href" class="min-w-0">
          <a
            :href="guide.href"
            class="flex items-start gap-3 px-4 py-3 text-xs no-underline transition-colors duration-150 hover:bg-ink/3"
            rel="noopener"
            target="_blank"
          >
            <Icon :name="guide.icon" aria-hidden="true" class="mt-px flex-none text-xl text-ink/70" />
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="font-medium text-ink">{{ guide.title }}</span>
              <span class="line-clamp-1 text-[11px] text-ink/55">{{ guide.detail }}</span>
            </span>
          </a>
        </li>
      </ul>
    </LayerCard>
  </div>
</template>

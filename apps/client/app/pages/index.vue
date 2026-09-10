<script setup lang="ts">
/**
 * Where this project stands, and what its sign-ins have been doing.
 *
 * Two questions in the order a customer asks them. Is it wired up, and is it working.
 * The strip at the top answers the first as five facts, each one linking to the screen
 * that owns it; the checklist under it exists only while one of those facts is still
 * missing, because a project that is finished should not be shown its own setup for
 * ever. Everything below is the second question.
 *
 * The method figures are read from the stores the method screens read, not from a
 * second set of the overview's own. An overview that disagreed with the screen it links
 * to is worse than one that shows less, and the count of passkey sign-ins is one number
 * whichever page is asking. They cover thirty days because that is the window those
 * stores keep, so the card says thirty days rather than following the range control it
 * cannot honour.
 *
 * The traffic series is still placeholder. The line under the chart says so once,
 * quietly, rather than a banner over the page saying it again.
 */
import type { SegmentedOption } from "~/components/SegmentedControl.vue";
import { isLive } from "~/utils/keys";
import type { MetricSeries } from "~/utils/metric-chart";
import { buildOverviewPreview, type OverviewRange } from "~/utils/overview";
import { PLATFORM_MARKS } from "~/utils/platform-marks";
import { describeAgent, PLATFORM_NAMES, sessionStatus } from "~/utils/sessions";

const projects = useProjectStore();
const keys = useKeysStore();
const origins = useOriginsStore();
const domains = useAuthDomainsStore();
const passwords = usePasswordPolicyStore();
const passkeys = usePasskeysStore();
const providers = useProvidersStore();
const otp = useOtpStore();
const sessions = useSessionsStore();

const project = computed(() => projects.current.id);
const loading = computed(() => keys.loading || origins.loading || domains.loading);

/*
 * What the project is set up with. Each fact is one store's answer and links to the
 * screen that owns it, so the strip is a table of contents as much as a status.
 */

const publishableKey = computed(() =>
  keys.keysFor(project.value).find((key) => isLive(key) && key.kind === "publishable"),
);
const allowedOrigins = computed(() => origins.forProject(project.value));
const authDomain = computed(() =>
  domains.forProject(project.value).find((row) => row.status === "verified"),
);

/** A method counts as on where a customer could sign in with it today. */
const methodsOn = computed(() => {
  const settings = otp.settingsFor(project.value);
  return [
    passwords.policyFor(project.value).enabled,
    passkeys.settingsFor(project.value).enabled,
    providers.configured(project.value).some((entry) => entry.config.enabled),
    settings.email.enabled || settings.sms.enabled || settings.magicLink.enabled,
  ].filter(Boolean).length;
});

/* Three of the five facts are what a sign-in needs before it can run at all. */
const ready = computed(
  () => Boolean(publishableKey.value) && allowedOrigins.value.length > 0 && methodsOn.value > 0,
);

const facts = computed(() => [
  {
    label: "Status",
    value: ready.value ? "Ready for sign-ins" : "Setup in progress",
    dot: ready.value ? "bg-success" : "bg-warning",
    to: "",
    action: "",
  },
  {
    label: "Publishable key",
    value: publishableKey.value ? `${publishableKey.value.prefix}…` : "None yet",
    mono: Boolean(publishableKey.value),
    to: "/keys",
    action: publishableKey.value ? "Manage keys" : "Create one",
  },
  {
    label: "Browser origins",
    value: allowedOrigins.value.length ? `${allowedOrigins.value.length} allowed` : "None allowed",
    to: "/domains/origins",
    action: allowedOrigins.value.length ? "Manage origins" : "Add one",
  },
  {
    label: "Sign-in methods",
    value: methodsOn.value ? `${methodsOn.value} on` : "None on",
    to: "/methods/passwords",
    action: methodsOn.value ? "Manage methods" : "Turn one on",
  },
  {
    label: "Auth domain",
    value: authDomain.value?.domain ?? "On the shared host",
    mono: Boolean(authDomain.value),
    to: "/domains",
    action: authDomain.value ? "Manage domain" : "Add one",
  },
]);

/*
 * Setup, while it is unfinished. Three rows rather than three panels: the sequence is
 * the whole content, and a card each would give every step an icon, a number, a pill
 * and a link to say what one line already says.
 */
const steps = computed(() => [
  {
    title: "Create a publishable key",
    detail: publishableKey.value
      ? `${publishableKey.value.prefix}… is live on this project.`
      : "The key your client application is built with. Public by construction.",
    done: Boolean(publishableKey.value),
    to: "/keys",
    action: publishableKey.value ? "View" : "Create a key",
  },
  {
    title: "Allow your application's origin",
    detail: allowedOrigins.value.length
      ? `${allowedOrigins.value.length} ${allowedOrigins.value.length === 1 ? "origin" : "origins"} may send authentication requests.`
      : "Only the browser origins on this list may send authentication requests.",
    done: allowedOrigins.value.length > 0,
    to: "/domains/origins",
    action: allowedOrigins.value.length ? "View" : "Add an origin",
  },
  {
    title: "Turn on a sign-in method",
    detail: methodsOn.value
      ? `${methodsOn.value} of four are on.`
      : "Passwords, passkeys, social providers or a one-time code. More can follow.",
    done: methodsOn.value > 0,
    to: "/methods/passwords",
    action: methodsOn.value ? "View" : "Choose a method",
  },
]);

const stepsDone = computed(() => steps.value.filter((step) => step.done).length);

/*
 * Activity. The range moves the tiles and the chart together, and the comparison on
 * each tile is the window immediately before it rather than a figure of its own.
 */

const RANGES: readonly SegmentedOption[] = [
  { value: "1d", label: "24h", title: "The last 24 hours" },
  { value: "7d", label: "7 days", title: "The last 7 days" },
  { value: "14d", label: "14 days", title: "The last 14 days" },
];

const RANGE_HOURS: Record<OverviewRange, number> = { "1d": 24, "7d": 168, "14d": 336 };

const range = ref<OverviewRange>("7d");
const view = ref<"chart" | "table">("chart");
const anchor = new Date();

const activity = computed(() => buildOverviewPreview(project.value, range.value, anchor));
const before = computed(() =>
  buildOverviewPreview(
    project.value,
    range.value,
    new Date(anchor.getTime() - RANGE_HOURS[range.value] * 3_600_000),
  ),
);

const compare = computed(() =>
  range.value === "1d" ? "vs the day before" : "vs the period before",
);

/*
 * What the chart plots: this period against the one before it, which is the pairing the
 * tiles above already compare on.
 *
 * Successes against failures was the obvious pair and it is the wrong one. Failures run
 * at a twentieth of the volume, so on one linear axis the second series is a line along
 * the bottom that carries no information and costs the first series most of its height.
 * The count of failures and which way it moved is a tile, where it reads.
 */
const chart = computed<MetricSeries[]>(() => [
  { name: "This period", data: activity.value.successful, tone: 1 },
  {
    name: "Period before",
    data: before.value.successful,
    tone: 2,
    type: "line",
    dashed: true,
  },
]);

/*
 * Where the sign-ins came from: four methods stacked over the days behind them.
 *
 * Each series is read from the store the method's own screen reads, so this card and
 * that screen cannot disagree. Those stores keep thirty daily buckets, which is what the
 * range control here offers windows of; the section's 24h is deliberately not among them,
 * because there is no hourly figure per method to draw and four bars on a single day is
 * a chart of one column.
 *
 * Stacked rather than grouped. The question a mix answers is what the total is made of,
 * and four bars a day for a month is a picket fence nobody can read a share off. A method
 * switched off today keeps whatever history it has: what happened happened, and what is
 * configured is stated in the strip at the top of the page.
 */
const DAY_LABEL = new Intl.DateTimeFormat("en", { day: "numeric", month: "short" });
const DAY_TITLE = new Intl.DateTimeFormat("en", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

const MIX_RANGES: readonly SegmentedOption[] = [
  { value: "7", label: "7 days", title: "The last 7 days" },
  { value: "14", label: "14 days", title: "The last 14 days" },
  { value: "30", label: "30 days", title: "The last 30 days" },
];

const mixRange = ref("14");

const mix = computed(() => {
  const span = Number(mixRange.value);
  const days = Array.from({ length: span }, (_, index) => {
    const at = new Date(anchor);
    at.setHours(0, 0, 0, 0);
    at.setDate(at.getDate() - (span - 1 - index));
    return at;
  });

  const series: MetricSeries[] = (
    [
      { name: "Passwords", data: passwords.stats(project.value).signInsDaily, tone: 1 },
      { name: "Passkeys", data: passkeys.stats(project.value).signInsDaily, tone: 2 },
      { name: "Social providers", data: providers.stats(project.value).signInsDaily, tone: 3 },
      { name: "Codes and links", data: otp.stats(project.value).signInsDaily, tone: 4 },
    ] satisfies MetricSeries[]
  ).map((entry) => ({ ...entry, data: entry.data.slice(-span), stack: "method" }));

  return {
    categories: days.map((at) => DAY_LABEL.format(at)),
    titles: days.map((at) => DAY_TITLE.format(at)),
    series,
    total: series.reduce(
      (sum, entry) => sum + entry.data.reduce((run: number, value) => run + (value ?? 0), 0),
      0,
    ),
  };
});

/*
 * What people sign in on: live sessions counted by the platform their user agent reports.
 *
 * A radar because the question is a profile and not a trend. Six fixed categories whose
 * relative sizes are the whole answer, where what a reader takes away is the shape, and
 * "mostly Apple, no Linux at all" is one glance rather than six numbers compared in the
 * head. It is also the one thing on this page that is a snapshot rather than a window,
 * which is why it carries no range control.
 *
 * The axes come from `PLATFORM_NAMES`, so a platform added to the parser appears here
 * rather than being quietly folded into the ones we could not place. Sessions whose agent
 * names nothing are left out and counted in the line under the chart, because a seventh
 * spoke called "Unknown" would make the shape about our parser.
 */
const platforms = computed(() => {
  const live = sessions
    .forProject(project.value)
    .filter((row) => sessionStatus(row, anchor) === "active");

  const counts = new Map(PLATFORM_NAMES.map((name) => [name, 0]));
  let unplaced = 0;
  for (const row of live) {
    const os = describeAgent(row.userAgent).os;
    if (os === null || !counts.has(os)) unplaced += 1;
    else counts.set(os, (counts.get(os) ?? 0) + 1);
  }

  return {
    axes: PLATFORM_NAMES,
    series: [
      {
        name: "Live sessions",
        data: PLATFORM_NAMES.map((name) => counts.get(name) ?? 0),
        tone: 1,
      },
    ] satisfies MetricSeries[],
    total: live.length,
    /* Written here rather than assembled in the template, where the whitespace between a
       moustache and a conditional block lands in the sentence as a space before a full
       stop. */
    note:
      unplaced === 0
        ? `${live.length.toLocaleString("en")} live ${live.length === 1 ? "session" : "sessions"}.`
        : `${live.length.toLocaleString("en")} live ${live.length === 1 ? "session" : "sessions"}, and ${unplaced} left out whose client names no platform we recognise.`,
  };
});

watch(project, () => {
  range.value = "7d";
  view.value = "chart";
  mixRange.value = "14";
});
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="Overview">
      <template #description>
        How <span class="font-medium text-ink">{{ projects.current.name }}</span> is set up, and
        what its sign-ins have been doing.
      </template>
      <template #actions>
        <v-btn
          class="text-xs font-medium"
          color="neutral"
          href="https://idenzy.dev/docs/quickstart"
          prepend-icon="material-symbols:book-2-outline"
          rel="noreferrer"
          size="small"
          target="_blank"
          variant="outlined"
        >
          Integration guide
        </v-btn>
      </template>
    </PageHeader>

    <!--
      The facts, as a strip rather than a card: it carries no heading because each column
      names itself, and giving it one would make five labels into six.

      The rules between the columns are the container's own background showing through a
      one-pixel gap, not a border on each cell. Five cells reflow to two columns and then
      to one, and a border rule would have to be turned off and on again per breakpoint at
      every edge; a gap is right at all three. The last cell spans the pair below `xl` so
      the odd count leaves no lit square where a cell is missing.
    -->
    <div
      class="grid gap-px overflow-hidden rounded-(--idenzy-radius) border border-line bg-line sm:grid-cols-2 xl:grid-cols-5"
    >
      <div
        v-for="fact in facts"
        :key="fact.label"
        class="flex min-w-0 flex-col gap-1.5 bg-surface px-4 py-3.5 last:sm:col-span-2 last:xl:col-span-1"
      >
        <span class="text-xs text-ink/55">{{ fact.label }}</span>

        <span v-if="loading" aria-hidden="true" class="h-4 w-24 animate-pulse rounded-full bg-ink/8" />
        <span v-else class="flex min-w-0 items-center gap-2">
          <span v-if="fact.dot" :class="fact.dot" aria-hidden="true" class="size-1.5 flex-none rounded-full" />
          <span :class="fact.mono ? 'font-mono text-[13px]' : 'text-sm'" class="truncate font-medium text-ink">
            {{ fact.value }}
          </span>
        </span>

        <NuxtLink
          v-if="fact.to"
          :to="fact.to"
          class="text-xs text-ink/55 no-underline transition-colors hover:text-ink"
        >
          {{ fact.action }}
        </NuxtLink>
        <span v-else class="text-xs text-ink/40">
          {{ ready ? "Every prerequisite is in place" : `${stepsDone} of 3 steps done` }}
        </span>
      </div>
    </div>

    <!--
      Setup, only while it is unfinished. A finished project keeps the facts above and
      loses this, which is the difference between a dashboard and an onboarding screen.
    -->
    <LayerCard
      v-if="!loading && !ready"
      :padded="false"
      description="What stands between this project and a sign-in that works. Each one is a screen in the drawer."
      title="Get connected"
    >
      <template #badge>
        <StatusBadge :label="`${stepsDone} of 3 done`" tone="neutral" />
      </template>

      <ul class="m-0 list-none divide-y divide-line p-0">
        <li
          v-for="step in steps"
          :key="step.title"
          class="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-4 py-3.5"
        >
          <span aria-hidden="true" class="flex h-5 w-5 items-center justify-center">
            <Icon
              :class="step.done ? 'text-success' : 'text-ink/25'"
              :name="
                step.done ? 'material-symbols:check-circle' : 'material-symbols:radio-button-unchecked'
              "
              class="text-base"
            />
          </span>

          <span class="flex min-w-0 flex-col gap-0.5">
            <span class="text-sm leading-5 font-medium text-ink">{{ step.title }}</span>
            <span class="text-xs leading-4 text-ink/55">{{ step.detail }}</span>
          </span>

          <NuxtLink
            :to="step.to"
            class="flex h-5 items-center gap-1 text-xs font-medium whitespace-nowrap text-ink no-underline transition-colors hover:text-ink/60"
          >
            {{ step.action }}
            <Icon aria-hidden="true" class="text-sm" name="material-symbols:arrow-forward" />
          </NuxtLink>
        </li>
      </ul>
    </LayerCard>

    <!--
      Activity. The range sits on the section rather than inside the chart, because it
      moves the tiles as well, and a control inside one card that changed another is a
      control in the wrong place.
    -->
    <section class="flex flex-col gap-4">
      <header class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div class="flex min-w-0 flex-col gap-0.5">
          <h2 class="m-0 text-sm font-medium text-ink">Sign-in activity</h2>
          <p class="m-0 text-xs text-ink/55">{{ activity.dateLabel }}</p>
        </div>
        <SegmentedControl v-model="range" :options="RANGES" label="Period" />
      </header>

      <div class="grid gap-4 sm:grid-cols-3">
        <Statistic
          :previous="before.signIns"
          :value="activity.signIns"
          :compare="compare"
          description="Every method on this project, counted where a session was issued."
          label="Successful sign-ins"
        />
        <Statistic
          :previous="before.failures"
          :value="activity.failures"
          :compare="compare"
          description="A wrong password, a spent code, an assertion the verifier refused."
          label="Failed attempts"
          positive="down"
        />
        <Statistic
          :previous="before.signUps"
          :value="activity.signUps"
          :compare="compare"
          description="Sign-ups that finished a first factor and reached a session."
          label="New accounts"
        />
      </div>

      <!-- No figure on the card. The tile a hundred pixels above already carries the
           total and the same comparison, and a number printed twice on one screen is
           read as two numbers that happen to agree. What the card is for is the shape. -->
      <MetricCard
        v-model:view="view"
        :categories="activity.categories"
        :category-label="range === '1d' ? 'Hour' : 'Day'"
        :series="chart"
        :titles="activity.titles"
        description="Successful sign-ins, against the same length of time immediately before it."
        title="Sign-ins over time"
        type="area"
      />

      <p class="m-0 text-xs text-ink/45">
        Times are UTC and the current {{ range === "1d" ? "hour" : "day" }} is partial. These
        figures are sample data until this project takes its first live sign-in.
      </p>
    </section>

    <!--
      Two charts on a twelve-column grid, eight and four. The mix is a daily series over
      weeks and needs the width; the platform profile is one small polygon and reading it
      does not improve with room. Equal halves would starve the first and pad the second.

      Both cards take the row's height, which the taller of the two sets, and the radar
      spends the difference on its picture rather than leaving a gap under it. Two cards
      side by side whose bottom edges did not line up would read as a layout that missed.
    -->
    <div class="grid gap-6 lg:grid-cols-12">
      <div class="lg:col-span-8">
        <MetricCard
          class="h-full"
          :categories="mix.categories"
          :series="mix.series"
          :titles="mix.titles"
          :value="mix.total"
          category-label="Day"
          compact
          description="Successful sign-ins by the method that made them."
          title="Where sign-ins come from"
          type="bar"
        >
          <template #actions>
            <SegmentedControl v-model="mixRange" :options="MIX_RANGES" label="Period" />
          </template>
        </MetricCard>
      </div>

      <!--
        The radar card is built here rather than as a component of its own, because this
        page is the only thing that wants one. Its shell is the metric card's, down to the
        padding: two cards side by side that framed their charts differently would read as
        two designs rather than one page.

        No legend. One series has nothing to tell apart, and the card's own title already
        says what the shape is.
      -->
      <v-card class="h-full lg:col-span-4" border flat>
        <div class="flex h-full flex-col gap-4 p-5">
          <header class="flex flex-col gap-1">
            <h2 class="m-0 text-sm leading-7 font-medium text-ink">What people sign in on</h2>
            <p class="m-0 text-sm text-ink/60">
              Live sessions by the platform their device reports.
            </p>
          </header>

          <!-- The minimum is what the chart is worth on its own, for the single column
               below `lg` where there is no card beside it to match and nothing to fill. -->
          <div class="min-h-[15.5rem] flex-1">
            <RadarChart
              :axes="platforms.axes"
              :marks="PLATFORM_MARKS"
              :series="platforms.series"
              fill
              label="Live sessions by device platform."
            />
          </div>

          <p class="m-0 text-xs text-ink/45">{{ platforms.note }}</p>
        </div>
      </v-card>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The chart's range: three spans counted back from now, or a piece of the calendar.
 *
 * One control and not two. The presets are what a visit almost always wants and the
 * calendar is what the one question a preset cannot answer wants, and a picker beside a
 * segmented control would have put the current range in two places with only one of them
 * right. So the button says what is on screen, whichever kind it is, and the menu holds
 * both ways of changing it with the presets first.
 *
 * **The calendar picks days and never hours.** `1d` is the hourly series, which is its own
 * table with its own six-month term and stores a level rather than a count
 * (`notes/usage.md`); a chosen span is answered from the daily rows. So the two are
 * different questions rather than two lengths of one, and the preset is the only way to
 * the hourly one.
 *
 * **Nothing is applied until Apply.** Both halves of the menu stage rather than write: the
 * rail holds a preset, the calendar holds a span, naming one drops the other, and the
 * model is untouched until the button. A span has to work this way — it is two clicks, and
 * between them the picker holds a range a day long that nobody asked for — and the rail
 * matches it, because a preset that took effect on the click shut the menu under a pointer
 * on its way to the calendar. Cancel puts both back to what the chart is already drawing.
 *
 * The span is bounded at both ends. `min` and `max` are the days the store actually holds
 * — seven months, the open one and six closed — because a day outside them has no row and
 * the chart would draw the gap that is honest and useless. `MAX_RANGE_DAYS` bounds the
 * other direction, where the categories become narrower than their own labels; over it
 * Apply says so rather than going dark with no reason.
 *
 * **The layout is `VDateRangePicker`'s, not ours.** It draws the two months, the divider
 * between them, the navigation across the pair and the footer its `footer` slot fills, and
 * it is a labs component registered by name in `nuxt.config.ts`. This was briefly built
 * out of two `VDatePicker`s instead, to get the days of the months either side into each
 * grid — `VDateRangePicker` writes `showAdjacentMonths: false` into its own render and no
 * prop can reach it. That bought a greyed-out 31st and cost the rest: a pair of pickers
 * has two of everything, so the month state had to be held here and fed back to both, and
 * Vuetify's own auto-navigation then moved the pair whenever a click landed on a date
 * outside the shown month. Two months side by side already answer the question the
 * adjacent days were there for.
 */
import {
  dayOf,
  isPreset,
  MAX_RANGE_DAYS,
  spanDays,
  type UsageDays,
  type UsagePreset,
  type UsageRange,
  usageWindow,
  windowLabel,
} from "~/utils/usage";

const props = defineProps<{
  /** The oldest and newest day the store holds, as `YYYY-MM-DD`. */
  earliest: string;
  latest: string;
  loading?: boolean;
}>();

const model = defineModel<UsageRange>({ required: true });

/**
 * The three spans counted back from now. `hint` is a tooltip on the row rather than a line
 * under it: which resolution a preset is read at settles a question somebody has once, and
 * a second line under every row made the rail as tall as the calendar to say it three
 * times.
 */
const PRESETS: readonly { value: UsagePreset; title: string; hint: string }[] = [
  {
    value: "1d",
    title: "Last 24 hours",
    hint: "Hour by hour, from the hourly meter. The one range that is not read from the daily rows.",
  },
  { value: "7d", title: "Last 7 days", hint: "Day by day, against the same dates a month before." },
  {
    value: "30d",
    title: "Last 30 days",
    hint: "Day by day, against the same dates a month before.",
  },
];

const open = ref(false);

/* The label is the window's own, so a preset and a chosen span are described by one
   function and cannot drift apart. The anchor only matters to a preset, and the picker is
   never the thing that decides where now is. */
const label = computed(() => {
  if (!isPreset(model.value)) return windowLabel(usageWindow(model.value, new Date()));
  return PRESETS.find((preset) => preset.value === model.value)?.title ?? "Range";
});

/*
 * The calendar's dates are local and the figures behind it are UTC, so the two are
 * converted at this boundary and nowhere else.
 *
 * Vuetify builds every date it hands back at local midnight and compares the ones it is
 * given the same way. A `YYYY-MM-DD` read off one of them with `toISOString` is therefore
 * the day before, for every reader east of UTC: clicking the 3rd in Istanbul produced
 * 2026-09-02, because local midnight there is 21:00 the previous day in UTC. The day a
 * person clicked is the day they saw, so it is read from the local parts; the reverse
 * puts it back at local midnight so the cell it lands on is the one it came from.
 */
function toDay(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function fromDay(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1);
}

const min = computed(() => fromDay(props.earliest));
const max = computed(() => fromDay(props.latest));

/*
 * The range being built, which the calendar owns until Apply.
 *
 * Seeded from whatever is on the chart rather than left empty, so the calendar opens on
 * the window already being drawn with it marked — and, because the picker positions itself
 * on the range it is given, on the months that window falls in.
 */
const draft = ref<Date[]>([]);

/**
 * The preset the rail is holding, which is a draft in the same way the calendar's span is.
 *
 * It used to apply on the click and shut the menu, which made the rail behave unlike
 * everything beside it: the calendar stages a span and waits for Apply, and a preset a
 * pointer passed over on the way to the calendar closed the whole thing and redrew the
 * chart. Both halves now stage, and Apply is the only thing that writes.
 *
 * The two are exclusive. Naming a preset replaces whatever was drawn, and drawing on the
 * calendar drops the preset, because the answer is one or the other and a rail showing a
 * selection the calendar disagrees with cannot say which.
 */
const pendingPreset = ref<UsagePreset | null>(null);

/** The days a range covers, for the calendar to mark. */
function daysOf(range: UsageRange): Date[] {
  const window = usageWindow(range, new Date());
  const first = window.buckets[0];
  const last = window.buckets.at(-1);
  return first === undefined || last === undefined
    ? []
    : [fromDay(dayOf(first)), fromDay(dayOf(last))];
}

function seed() {
  draft.value = daysOf(model.value);
  pendingPreset.value = isPreset(model.value) ? model.value : null;
}

watch([model, open], seed, { immediate: true });

function choosePreset(value: UsagePreset) {
  pendingPreset.value = value;
  /* The calendar marks the preset's own days, so the rail and the months agree on what
     Apply would do before it is pressed. */
  draft.value = daysOf(value);
}

function onCalendar(value: unknown) {
  pendingPreset.value = null;
  draft.value = (Array.isArray(value) ? value : []).filter(
    (entry): entry is Date => entry instanceof Date,
  );
}

/** The draft as a span, or null while it has only one end. */
const pending = computed<UsageDays | null>(() => {
  const first = draft.value[0];
  const last = draft.value.at(-1);
  if (draft.value.length < 2 || first === undefined || last === undefined) return null;
  return { from: toDay(first), to: toDay(last) };
});

const pendingDays = computed(() => (pending.value ? spanDays(pending.value) : 0));
const tooLong = computed(() => pendingDays.value > MAX_RANGE_DAYS);

/** Whether Apply would change anything, so a second press of it is not offered. */
const changed = computed(() => {
  const preset = pendingPreset.value;
  if (preset !== null) return preset !== model.value;
  if (pending.value === null) return false;
  if (isPreset(model.value)) return true;
  return model.value.from !== pending.value.from || model.value.to !== pending.value.to;
});

const canApply = computed(() => {
  if (!changed.value) return false;
  if (pendingPreset.value !== null) return true;
  return pending.value !== null && !tooLong.value;
});

/** One line in the footer: what is staged, or what is stopping it. */
const note = computed(() => {
  const preset = pendingPreset.value;
  if (preset !== null) {
    /* What it draws rather than which dates it covers: `1d` is the hourly series, and a
       span of dates is the one thing it is not. */
    const entry = PRESETS.find((held) => held.value === preset);
    return entry?.hint ?? "";
  }
  if (pending.value === null) return "Pick the first day, then the last.";
  if (tooLong.value) {
    return `${pendingDays.value} days is past the ${MAX_RANGE_DAYS} this chart draws.`;
  }
  return `${pendingDays.value} ${pendingDays.value === 1 ? "day" : "days"}, ${pending.value.from} to ${pending.value.to}.`;
});

function apply() {
  if (!canApply.value) return;
  const preset = pendingPreset.value;
  if (preset !== null) {
    model.value = preset;
  } else if (pending.value !== null) {
    model.value = pending.value;
  } else {
    return;
  }
  open.value = false;
}

function cancel() {
  seed();
  open.value = false;
}

/* `pendingPreset` is what the rail reads and writes directly now that the rows are
   buttons: a list's selection model was a second place for the same fact to live, and it
   could disagree with the calendar about whether a preset was staged at all. */
</script>

<template>
  <v-btn
    :aria-label="`Chart range: ${label}`"
    :disabled="loading"
    append-icon="material-symbols:unfold-more"
    class="idenzy-toolbar-control text-xs font-medium"
    color="neutral"
    prepend-icon="material-symbols:date-range-outline"
    size="small"
    variant="text"
  >
    {{ label }}

    <v-menu
      v-model="open"
      :close-on-content-click="false"
      :offset="4"
      activator="parent"
      location="bottom end"
    >
      <!--
        Vuetify's own arrangement for this control: the presets as a list, a rule, and the
        range picker with its footer.

        `flex` and not Vuetify's `d-flex`. `styles: { utilities: false }` in nuxt.config.ts
        switches its utility classes off — 236 KB of them, half colliding with Tailwind's —
        so `d-flex` is a class that does not exist here and the card stayed `display: block`
        with the presets stacked on top of the calendar and a divider nothing could stretch.
        Every layout class in this panel is Tailwind's.
      -->
      <v-card border class="range__card flex" flat>
        <!--
          The presets are the panel's ghost buttons, not list rows: the same text button
          the page header and every toolbar here is made of, stacked and left-aligned. A
          `v-list` gave them a component's worth of its own behaviour — density, lines,
          nav padding, an item overlay — for three things that only need pressing.

          The one staged carries a ground, because the rail has to say which of the three
          Apply would write without a second line under each to explain the difference.
        -->
        <div class="flex w-[11.5rem] flex-none flex-col gap-0.5 p-1.5">
          <v-btn
            v-for="preset in PRESETS"
            :key="preset.value"
            :aria-label="`${preset.title}. ${preset.hint}`"
            :aria-pressed="pendingPreset === preset.value"
            :class="
              pendingPreset === preset.value ? 'bg-ink/8 text-ink' : 'text-ink/70 hover:text-ink'
            "
            class="justify-start text-xs font-medium"
            color="neutral"
            size="small"
            variant="text"
            @click="choosePreset(preset.value)"
          >
            {{ preset.title }}

            <!-- Inside the button and after the label, so the thing it explains is the
                 thing it sits in. `activator="parent"` binds it to this span rather than
                 to the button, which would put the tooltip over the whole row. -->
            <span aria-hidden="true" class="ml-1.5 inline-flex items-center text-ink/40">
              <Icon class="text-sm" name="material-symbols:info-outline" />
              <v-tooltip
                :text="preset.hint"
                activator="parent"
                location="top"
                max-width="260"
                open-delay="200"
              />
            </span>
          </v-btn>
        </div>

        <v-divider class="self-stretch" vertical />

        <v-date-range-picker
          :max="max"
          :min="min"
          :model-value="draft"
          @update:model-value="onCalendar"
          class="range__picker min-w-0"
          color="primary"
          hide-header
          :weeks-in-month="'dynamic'"
          independent-months
        >
          <template #footer>
            <p :class="tooLong ? 'text-warning' : 'text-ink/50'" class="m-0 text-[11px] leading-4">
              {{ note }}
            </p>
            <v-spacer />
            <v-btn
              class="text-xs font-medium text-ink/70 hover:text-ink"
              size="small"
              variant="text"
              @click="cancel"
            >
              Cancel
            </v-btn>
            <v-btn
              :disabled="!canApply"
              class="text-xs font-medium"
              color="primary"
              size="small"
              variant="text"
              @click="apply"
            >
              Apply
            </v-btn>
          </template>
        </v-date-range-picker>
      </v-card>
    </v-menu>
  </v-btn>
</template>

<style scoped>
/*
 * The picker keeps Vuetify's layout and takes the panel's type.
 *
 * Nothing here moves anything. The two months, the rule between them, the navigation over
 * the pair, the span, the preview of one under the pointer and every hover overlay are the
 * component's own; what changes is the size of the type, which arrives at Material's
 * 0.875rem and is larger than the axis labels on the chart the menu opens over.
 */
.range__card {
  max-width: calc(100vw - 2rem);
}

/*
 * One kind of rule inside the control.
 *
 * There are two vertical lines here — this one between the rail and the calendar, and the
 * picker's own between the two months — and they were not drawn the same way.
 * `.v-date-range-picker__divider` is a plain `border-inline-start` in
 * `rgba(var(--v-border-color), var(--v-border-opacity))`. `VDivider` takes that same colour
 * through the same opacity and then sets `opacity: var(--v-border-opacity)` on the element
 * as well, so the opacity lands twice and the line comes out the fainter of the two; on top
 * of that it carries `margin-left: -1px`, which tucks it a pixel under the list rather than
 * sitting in the gap.
 *
 * Both are undone here, so the two rules are the same pixel — which is what theme.css says
 * a card's edge, a menu's edge and a divider should be wherever they meet.
 */
.range__card :deep(.v-divider--vertical) {
  border-color: rgba(var(--v-border-color), var(--v-border-opacity));
  margin: 0;
  opacity: 1;
}

.range__picker :deep(.v-date-picker) {
  background: transparent;
}

.range__picker :deep(.v-date-picker-controls) {
  min-height: var(--idenzy-toolbar-height);
}

.range__picker :deep(.v-date-picker-controls),
.range__picker :deep(.v-date-picker-controls .v-btn),
.range__picker :deep(.v-date-range-picker__header) {
  font-size: 0.75rem;
  font-weight: 500;
}

/* The weekday letters are a legend, not data: one step under the figures they head, which
   is the same pair of sizes a table's column label and its cells use. */
.range__picker :deep(.v-date-picker-month__weekday) {
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
}

/* Vuetify's own knob for the figure on a day, and only that. The cell, the control inside
   it, the gaps and everything drawn behind them are the component's: 0.75rem is what the
   tables and the tiles use, against the 0.875rem Material asks for. */
.range__picker :deep(.v-btn.v-date-picker-month__day-btn) {
  --v-btn-size: 0.75rem;

  font-weight: 500;
  letter-spacing: 0;
}

/*
 * The day is a circle again, which is Vuetify's shape for it and the shape of its hover.
 *
 * It renders the day with `icon: true` and rounds it in `.v-btn--icon`. theme.css rounds
 * every `.v-btn` in the panel to the standard radius; the two selectors weigh the same, so
 * the panel's wins on load order and the circle comes out a rounded square. That would be
 * a shape argument and nothing more, except `.v-btn` is `overflow: hidden` and
 * `.v-btn__overlay` fills it — so the overlay Vuetify lights under the pointer is clipped
 * to whatever the button's radius is, and a square lit up inside a span rounded at 999px.
 *
 * So this is the button's radius and not the overlay's: the overlay, its opacity and its
 * timing stay Vuetify's, and clipping gives it the shape back. Restated here rather than
 * weakened in theme.css, because every other button in the panel wants that radius and
 * only a calendar's days want the circle.
 */
.range__picker :deep(.v-btn.v-date-picker-month__day-btn) {
  border-radius: 50%;
  height: 36px;
  width: 36px;
}

</style>

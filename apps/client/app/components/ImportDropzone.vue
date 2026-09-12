<script lang="ts">
import type { ImportFormat, ImportRecord } from "~/utils/import";

/** A file read and parsed in the browser: what the later steps work from. */
export interface ImportFile {
  name: string;
  size: number;
  format: ImportFormat;
  records: ImportRecord[];
  /** Every column seen across the first records, in the order first seen. */
  keys: string[];
}
</script>

<script setup lang="ts">
/**
 * Where the export lands. A drop target and a file picker in one, which reads the file
 * in the browser and parses it there, so the next steps can show the operator their
 * own columns and their own rows before anything is sent.
 *
 * Once a file is chosen the target becomes a card about it: the page glyph with the
 * format on its corner, the name, how far the read has got, and what was found. The
 * bar is real for the moment it takes to read and full thereafter, and the card stays
 * so the step reads as done and not as a form left filled in. A file that does not
 * parse says why under the target and asks for another.
 */
import { detectFormat, FORMAT_LABELS, parseRecords } from "~/utils/import";
import { writeFigure } from "~/utils/format";

const props = defineProps<{
  accept: readonly ImportFormat[];
}>();

const file = defineModel<ImportFile | null>({ required: true });

const input = useTemplateRef<HTMLInputElement>("input");
const dragging = ref(false);
const error = ref("");

/** The file being read, before it is parsed: the card is drawn from this meanwhile. */
const pending = ref<{ name: string; size: number } | null>(null);

const accepts = computed(() => props.accept.map((format) => FORMAT_LABELS[format]).join(", "));

const SAMPLE = 50;

/* The badge on the page's corner, one colour per format so a glance tells them apart. */
const BADGES: Record<ImportFormat, string> = {
  csv: "bg-success",
  json: "bg-primary",
  ndjson: "bg-warning",
};

const shown = computed(() => file.value ?? pending.value);
const format = computed(() => file.value?.format ?? null);

async function read(chosen: File) {
  error.value = "";
  file.value = null;
  pending.value = { name: chosen.name, size: chosen.size };
  // A frame with the bar at nothing, so the fill is seen to happen.
  await new Promise((resolve) => requestAnimationFrame(resolve));

  const text = await chosen.text();
  const detected = detectFormat(chosen.name, text);
  const parsed =
    detected === null
      ? { ok: false as const, reason: "This is not a JSON, NDJSON or CSV file." }
      : parseRecords(text, detected);

  if (!parsed.ok) {
    error.value = parsed.reason;
  } else if (parsed.records.length === 0) {
    error.value = "The file holds no users.";
  } else if (detected !== null) {
    file.value = {
      name: chosen.name,
      size: chosen.size,
      format: detected,
      records: parsed.records,
      keys: keysOf(parsed.records),
    };
  }
  pending.value = null;
}

/* The columns are read off the first records only: a file of a million rows has the
   same columns on row one and row fifty, and the review step reads them all anyway. */
function keysOf(records: readonly ImportRecord[]): string[] {
  const keys: string[] = [];
  for (const record of records.slice(0, SAMPLE)) {
    for (const key of Object.keys(record)) if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

function onPick(event: Event) {
  const chosen = (event.target as HTMLInputElement).files?.[0]; // the input this handles
  if (chosen) void read(chosen);
}

function onDrop(event: DragEvent) {
  dragging.value = false;
  const chosen = event.dataTransfer?.files[0];
  if (chosen) void read(chosen);
}

function change() {
  input.value?.click();
}

function remove() {
  file.value = null;
  pending.value = null;
  error.value = "";
  if (input.value) input.value.value = "";
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <input
      ref="input"
      accept=".json,.ndjson,.jsonl,.csv,application/json,text/csv"
      class="sr-only"
      type="file"
      @change="onPick"
    />

    <!-- An inset in the dialog, so a tint of the ink with a hairline ring and never the
         page's own ground: on the dark theme a canvas-toned box cut into the surface is
         the darkest thing on the screen, over the one file the reader came to check. -->
    <div
      v-if="shown"
      class="flex items-start gap-4 rounded-(--idenzy-radius) bg-ink/4 py-4 pr-5 pl-4 ring-1 ring-ink/6 ring-inset"
    >
      <span aria-hidden="true" class="relative mt-0.5 flex h-12 w-10 flex-none items-center">
        <svg class="ml-1 block" fill="none" height="48" viewBox="0 0 36 48" width="36">
          <path
            class="fill-ink/8"
            d="M27.8 48H8.2c-2.99 0-4.484 0-5.609-.618a5 5 0 0 1-1.973-1.973C0 44.284 0 42.789 0 39.8V8.2c0-2.99 0-4.484.618-5.609A5 5 0 0 1 2.591.618C3.716 0 5.211 0 8.2 0h12.032c1.314 0 1.971 0 2.587.16a5 5 0 0 1 1.31.546c.546.325 1.008.793 1.932 1.727l7.569 7.65c.91.921 1.366 1.382 1.683 1.923.237.404.416.84.532 1.294.155.608.155 1.255.155 2.55V39.8c0 2.99 0 4.484-.618 5.609a5 5 0 0 1-1.973 1.973C32.284 48 30.789 48 27.8 48Z"
          />
          <path class="fill-ink/12" d="M23 .5v8.3c0 1.7 0 2.55.33 3.2a3 3 0 0 0 1.31 1.31c.65.33 1.5.33 3.2.33H35.5L23 .5Z" />
        </svg>
        <span
          v-if="format"
          :class="BADGES[format]"
          class="absolute -left-1 bottom-2.5 rounded-[4px] px-1 py-[3px] font-mono text-[10px] leading-none font-medium tracking-wide text-white shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
        >
          {{ FORMAT_LABELS[format] }}
        </span>
      </span>

      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <div class="flex items-center justify-between gap-3 text-xs">
          <span class="truncate font-medium text-ink">{{ shown.name }}</span>
          <span v-if="file" class="inline-flex flex-none items-center gap-1 text-ink/70">
            <Icon aria-hidden="true" class="text-base text-success" name="material-symbols:check-circle" />
            Read
          </span>
          <span v-else class="inline-flex flex-none items-center gap-1 text-ink/70">
            <Icon aria-hidden="true" class="animate-spin text-base text-ink/50" name="material-symbols:progress-activity" />
            Reading
          </span>
        </div>

        <div
          :aria-valuenow="file ? 100 : 0"
          aria-label="Read progress"
          aria-valuemax="100"
          aria-valuemin="0"
          class="h-1.5 w-full overflow-hidden rounded-full bg-ink/8"
          role="progressbar"
        >
          <div
            :class="file ? 'bg-success' : 'bg-primary'"
            :style="{ width: file ? '100%' : '0%' }"
            class="h-full rounded-full transition-[width] duration-500 ease-out"
          />
        </div>

        <p class="m-0 font-mono text-[11px] text-ink/55 tabular-nums">
          {{ writeFigure(file ? shown.size : 0, { format: "bytes" }) }}
          of
          {{ writeFigure(shown.size, { format: "bytes" }) }}
          <template v-if="file">
            · {{ file.records.length.toLocaleString("en") }}
            {{ file.records.length === 1 ? "row" : "rows" }}
            · {{ file.keys.length }} columns
          </template>
        </p>

        <div v-if="file" class="flex gap-2 pt-1">
          <button
            class="h-7 rounded-(--idenzy-radius-x-small) bg-ink/6 px-2.5 text-xs font-medium text-ink/80 transition-colors duration-150 hover:bg-ink/10 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            type="button"
            @click="change"
          >
            Change
          </button>
          <button
            class="h-7 rounded-(--idenzy-radius-x-small) bg-error/10 px-2.5 text-xs font-medium text-error transition-colors duration-150 hover:bg-error/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            type="button"
            @click="remove"
          >
            Remove
          </button>
        </div>
      </div>
    </div>

    <label
      v-else
      :class="dragging ? 'border-primary bg-primary/4' : 'border-line hover:border-ink/25 hover:bg-ink/2'"
      class="flex cursor-pointer flex-col items-center gap-3 rounded-(--idenzy-radius) border border-dashed px-6 py-10 text-center transition-colors duration-150 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary"
      @dragenter.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @dragover.prevent="dragging = true"
      @drop.prevent="onDrop"
    >
      <span
        class="flex size-11 items-center justify-center rounded-(--idenzy-radius-small) border border-line bg-surface text-ink/60"
      >
        <Icon aria-hidden="true" class="text-2xl" name="material-symbols:upload-file-outline" />
      </span>
      <span class="flex flex-col gap-1">
        <span class="text-sm font-medium text-ink">Drop the export here, or click to choose it</span>
        <span class="text-xs text-ink/55">
          {{ accepts }}. Read in your browser first; nothing is sent until you run the import.
        </span>
      </span>
      <input class="sr-only" type="file" @change="onPick" />
    </label>

    <p v-if="error" class="m-0 flex items-start gap-1.5 text-xs text-error" role="alert">
      <Icon aria-hidden="true" class="mt-px flex-none text-sm" name="material-symbols:error-outline" />
      {{ error }}
    </p>
  </div>
</template>

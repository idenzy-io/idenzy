<script setup lang="ts">
/**
 * What the panel actually looked at, and what it cannot see.
 *
 * The finding this exists for is that "not found" reads as "the mail will arrive". It
 * cannot: this list records what we refuse to send, never what a mailbox did with what we
 * sent, and while the provider event pipeline is unbuilt it does not even record the
 * refusals. So the dialog states the comparison, the record behind it where there is one,
 * and the two questions that are answered somewhere else.
 *
 * It reveals nothing the reader did not type: the address is theirs, the digest is what
 * left the browser, and neither is copied anywhere unless they ask.
 */
import {
  type DeliveryCapability,
  type LookupAnswer,
  reasonLabel,
  SUPPRESSION_CHANNEL_LABELS,
  sourceLabel,
} from "~/utils/suppressions";
import { formatDateTime } from "~/utils/time";

const props = defineProps<{
  answer: LookupAnswer;
  projectName: string;
  ingestion: boolean;
  /** The parts that are not built, so the gaps are named rather than described. */
  missing: readonly DeliveryCapability[];
}>();

const open = defineModel<boolean>({ required: true });

const titleId = useId();

const verdictWord = computed(() => {
  if (props.answer.verdict === "unavailable") return "Nothing was compared";
  if (props.answer.verdict === "blocked") return "Blocked from delivery";
  return props.ingestion ? "No block found" : "No block found, and none would have been recorded";
});

/** The comparison itself, which is the only thing this page performed. */
const checked = computed(() => [
  { id: "address", label: "Address asked about", value: props.answer.asked, mono: true },
  { id: "project", label: "Project", value: props.projectName, mono: false },
  { id: "channel", label: "Channel", value: SUPPRESSION_CHANNEL_LABELS.email, mono: false },
  { id: "at", label: "Checked at", value: formatDateTime(props.answer.checkedAt), mono: true },
  { id: "answer", label: "Answer", value: verdictWord.value, mono: false },
]);

/** The row behind a block, as it was recorded rather than as the screen words it. */
const record = computed(() => {
  const row = props.answer.email;
  if (row === null) return [];
  return [
    { id: "id", label: "Record", value: row.id, mono: true },
    { id: "reason", label: "Reason as recorded", value: row.reason, mono: true },
    { id: "label", label: "Reason", value: reasonLabel(row.reason), mono: false },
    { id: "source", label: "Source", value: sourceLabel(row.reason), mono: false },
    { id: "at", label: "Recorded at", value: formatDateTime(row.createdAt), mono: true },
    {
      id: "event",
      label: "Provider event",
      value: row.providerEventId ?? "None: not written by a provider event",
      mono: row.providerEventId !== undefined,
    },
  ];
});
</script>

<template>
  <v-dialog v-model="open" max-width="600" scrollable>
    <v-card :aria-labelledby="titleId" border flat role="dialog">
      <div class="flex flex-col gap-5 p-5">
        <header class="flex flex-col gap-1">
          <h2 :id="titleId" class="m-0 text-sm font-medium text-ink">
            Delivery evidence for this address
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            Everything behind the answer above, on
            <span class="font-medium text-ink">{{ projectName }}</span
            >, and the parts of the question this panel cannot answer.
          </p>
        </header>

        <section class="flex flex-col gap-2">
          <h3 class="m-0 text-[11px] font-medium tracking-wide text-ink/50 uppercase">
            What was checked
          </h3>
          <dl
            class="m-0 flex flex-col gap-2 rounded-(--idenzy-radius-small) bg-ink/4 px-4 py-3 ring-1 ring-ink/6 ring-inset"
          >
            <div
              v-for="line in checked"
              :key="line.id"
              class="flex items-baseline justify-between gap-3"
            >
              <dt class="flex-none text-[11px] text-ink/55">{{ line.label }}</dt>
              <dd
                :class="line.mono ? 'font-mono' : ''"
                class="m-0 min-w-0 truncate text-xs text-ink"
                :title="line.value"
              >
                {{ line.value }}
              </dd>
            </div>
          </dl>
          <div v-if="answer.digest !== ''" class="flex flex-col gap-1">
            <span class="text-[11px] text-ink/55">Digest the block list was asked about</span>
            <CopyField :value="answer.digest" dense label="Copy digest" />
          </div>
        </section>

        <section v-if="record.length > 0" class="flex flex-col gap-2">
          <h3 class="m-0 text-[11px] font-medium tracking-wide text-ink/50 uppercase">
            The record behind it
          </h3>
          <dl
            class="m-0 flex flex-col gap-2 rounded-(--idenzy-radius-small) bg-ink/4 px-4 py-3 ring-1 ring-ink/6 ring-inset"
          >
            <div
              v-for="line in record"
              :key="line.id"
              class="flex items-baseline justify-between gap-3"
            >
              <dt class="flex-none text-[11px] text-ink/55">{{ line.label }}</dt>
              <dd
                :class="line.mono ? 'font-mono' : ''"
                class="m-0 min-w-0 truncate text-xs text-ink"
                :title="line.value"
              >
                {{ line.value }}
              </dd>
            </div>
          </dl>
        </section>

        <section class="flex flex-col gap-2">
          <h3 class="m-0 text-[11px] font-medium tracking-wide text-ink/50 uppercase">
            What this is not evidence of
          </h3>
          <ul class="m-0 flex list-none flex-col gap-2 p-0">
            <li class="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-2">
              <Icon
                aria-hidden="true"
                class="mt-px text-base text-ink/40"
                name="material-symbols:mark-email-unread-outline"
              />
              <span class="text-xs leading-5 text-ink/65">
                Whether a message arrived. This list says what we refuse to send; what a
                mailbox did with an accepted message is in the provider console.
              </span>
            </li>
            <li
              v-for="gap in missing"
              :key="gap.id"
              class="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-2"
            >
              <Icon
                aria-hidden="true"
                class="mt-px text-base text-warning/80"
                name="material-symbols:error-outline"
              />
              <span class="text-xs leading-5 text-ink/65">
                <span class="font-medium text-ink">{{ gap.label }}:</span> {{ gap.finding }}
              </span>
            </li>
          </ul>
        </section>

        <footer class="flex items-center justify-end">
          <v-btn
            class="text-xs font-medium"
            color="neutral"
            size="small"
            variant="text"
            @click="open = false"
          >
            Close
          </v-btn>
        </footer>
      </div>
    </v-card>
  </v-dialog>
</template>

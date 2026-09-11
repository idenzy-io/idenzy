<script setup lang="ts">
/**
 * Allowing email to one address again.
 *
 * Behind a dialog because releasing is not undoing a mistake, it is overruling a mailbox
 * provider that told us the address does not exist or that its owner marked us as spam.
 * The reader is shown what they are overruling, asked for the evidence that sending can
 * resume, and told what the release does not cover: the channel is part of the record, so
 * an SMS block on the same address stays exactly where it was.
 *
 * The reason is a required field rather than a tick where a provider reported the block.
 * A box saying "I understand" records that somebody clicked; a sentence records why, which
 * is what the next person to read the trail actually needs. Where the block was added from
 * this dashboard there is nothing to overrule and no reason is asked for.
 */
import {
  JUSTIFICATION_ISSUE_LABELS,
  type JustificationIssue,
  justificationExample,
  reasonInfo,
  reasonLabel,
  releaseDecision,
  SUPPRESSION_CHANNEL_LABELS,
  type SuppressionRow,
  shortDigest,
  sourceLabel,
  validateJustification,
} from "~/utils/suppressions";
import { formatDateTime } from "~/utils/time";

const props = defineProps<{
  row: SuppressionRow;
  /** The address that was typed to find it. Shown, never sent anywhere. */
  address: string;
  projectName: string;
  /** The same address blocked elsewhere, which this release leaves alone. */
  others: readonly SuppressionRow[];
  busy: boolean;
  /** A failed write, kept beside the field rather than closing over it. */
  error: string;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [justification: string];
}>();

const titleId = useId();
const fieldId = useId();
const helpId = `${fieldId}-help`;
const errorId = `${fieldId}-error`;

const info = computed(() => reasonInfo(props.row.reason));
const decision = computed(() => releaseDecision(props.row));
const needsReason = computed(() => decision.value.rule === "justified");

/** The channels this release leaves blocked, written as the reader would say them. */
const untouched = computed(() =>
  props.others.map((row) => SUPPRESSION_CHANNEL_LABELS[row.channel]).join(" and "),
);

const justification = ref("");
const submitted = ref(false);
const field = useTemplateRef<HTMLTextAreaElement>("field");

/* A fresh decision every time it opens: a reason typed for one address is not a reason
   for the next one. */
watch(open, (value) => {
  if (!value) return;
  justification.value = "";
  submitted.value = false;
});

/* Blank is not an error until somebody has tried to submit (notes/layout-blueprint.md). */
const issue = computed<JustificationIssue | null>(() => {
  if (!needsReason.value || !submitted.value) return null;
  return validateJustification(justification.value);
});

function confirm() {
  submitted.value = true;
  if (props.busy) return;
  if (needsReason.value && validateJustification(justification.value) !== null) {
    field.value?.focus();
    return;
  }
  emit("confirm", justification.value.trim());
}
</script>

<template>
  <v-dialog v-model="open" :persistent="busy" max-width="560" scrollable>
    <v-card :aria-labelledby="titleId" border flat role="dialog">
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 :id="titleId" class="m-0 text-sm font-medium text-ink">
            Allow email to this address again
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            On <span class="font-medium text-ink">{{ projectName }}</span
            >, {{ SUPPRESSION_CHANNEL_LABELS[row.channel].toLowerCase() }} only. The block is
            removed and the next message to the address is attempted normally.
          </p>
        </header>

        <!-- Exactly what is being released, in the reader's own terms and in the
             record's. The digest is here because it is what the request carries. -->
        <dl
          class="m-0 flex flex-col gap-2 rounded-(--idenzy-radius-small) bg-ink/4 px-4 py-3 ring-1 ring-ink/6 ring-inset"
        >
          <div v-if="address" class="flex items-baseline justify-between gap-3">
            <dt class="flex-none text-[11px] text-ink/55">Address</dt>
            <dd class="m-0 min-w-0 truncate font-mono text-xs text-ink">{{ address }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-3">
            <dt class="flex-none text-[11px] text-ink/55">Channel</dt>
            <dd class="m-0 text-xs text-ink">{{ SUPPRESSION_CHANNEL_LABELS[row.channel] }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-3">
            <dt class="flex-none text-[11px] text-ink/55">Blocked because</dt>
            <dd class="m-0 min-w-0 truncate text-xs text-ink">{{ reasonLabel(row.reason) }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-3">
            <dt class="flex-none text-[11px] text-ink/55">Source</dt>
            <dd class="m-0 min-w-0 truncate text-xs text-ink/75">{{ sourceLabel(row.reason) }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-3">
            <dt class="flex-none text-[11px] text-ink/55">Recorded</dt>
            <dd class="m-0 font-mono text-xs text-ink/75">{{ formatDateTime(row.createdAt) }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-3">
            <dt class="flex-none text-[11px] text-ink/55">Digest</dt>
            <dd class="m-0 font-mono text-xs text-ink/75">{{ shortDigest(row.targetHash) }}</dd>
          </div>
        </dl>

        <p v-if="info" class="m-0 text-xs leading-5 text-ink/60">{{ info.note }}</p>

        <!-- The evidence, typed. Where a provider reported the block this is the whole
             decision, so it is a field with an example rather than a box to tick. -->
        <div v-if="needsReason" class="flex flex-col gap-1.5">
          <label class="text-xs font-medium text-ink" :for="fieldId">
            Why is it safe to send to this address again?
          </label>
          <textarea
            :id="fieldId"
            ref="field"
            v-model="justification"
            :aria-describedby="issue ? errorId : helpId"
            :aria-invalid="issue !== null"
            :class="
              issue
                ? 'border-error focus-visible:outline-error'
                : 'border-line focus-visible:outline-primary'
            "
            class="w-full resize-y rounded-(--idenzy-radius-small) bg-ink/4 px-3 py-2 text-xs leading-5 text-ink ring-1 ring-ink/6 ring-inset focus-visible:outline-2 focus-visible:outline-offset-1"
            name="release-reason"
            placeholder="What changed, and who confirmed it"
            rows="3"
          />
          <p
            v-if="issue"
            :id="errorId"
            class="m-0 text-[11px] leading-4 text-error"
            role="alert"
          >
            {{ JUSTIFICATION_ISSUE_LABELS[issue] }}
          </p>
          <p v-else :id="helpId" class="m-0 text-[11px] leading-4 text-ink/55">
            {{ justificationExample(row.reason) }} It is kept with the release, so the
            decision is still readable after the block is gone.
          </p>
        </div>

        <!-- What changes and what does not. The second half is the acceptance check: an
             email release must not quietly take an SMS block with it. -->
        <div class="flex flex-col gap-2 border-t border-line pt-4">
          <div class="flex items-start gap-2.5">
            <Icon
              aria-hidden="true"
              class="mt-px flex-none text-base text-ink/45"
              name="material-symbols:arrow-forward"
            />
            <p class="m-0 text-xs leading-5 text-ink/65">
              Now every message to it is refused before any transport runs. After this, the
              next one is attempted like any other. Nothing is sent to check.
            </p>
          </div>
          <div v-if="others.length > 0" class="flex items-start gap-2.5">
            <Icon
              aria-hidden="true"
              class="mt-px flex-none text-base text-ink/45"
              name="material-symbols:lock-outline"
            />
            <p class="m-0 text-xs leading-5 text-ink/65">
              The {{ untouched }} block on this address stays in place, and so does every
              block on every other project.
            </p>
          </div>
          <div v-if="info?.severe" class="flex items-start gap-2.5">
            <Icon
              aria-hidden="true"
              class="mt-px flex-none text-base text-warning"
              name="material-symbols:error-outline"
            />
            <p class="m-0 text-xs leading-5 text-ink/65">
              A provider reported this one. Sending to it again while the problem stands
              costs a sending reputation shared with every project on the domain.
            </p>
          </div>
        </div>

        <p v-if="error" class="m-0 text-[11px] leading-4 text-error" role="alert">{{ error }}</p>

        <footer class="flex items-center justify-end gap-2">
          <v-btn
            :disabled="busy"
            class="text-xs font-medium"
            color="neutral"
            size="small"
            variant="text"
            @click="open = false"
          >
            Cancel
          </v-btn>
          <v-btn
            :loading="busy"
            class="text-xs font-medium"
            color="warning"
            size="small"
            type="submit"
            variant="flat"
          >
            Allow email again
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>

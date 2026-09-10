<script lang="ts">
/** What the sample user makes of this mapping, for the line under the row. */
export type ClaimRowOutcome =
  | { kind: "present"; value: unknown; bytes: number }
  | { kind: "absent" }
  | { kind: "refused" }
  | { kind: "invalid" };
</script>

<script setup lang="ts">
/**
 * One mapping, editable in place and read as a sentence: the name the token will carry,
 * then where it comes from, then whether a token without it is worth issuing.
 *
 * Under the sentence is the one line that makes the row honest: what this claim turns
 * into for the sample user, in bytes, or why it does not. A row whose name the server
 * would refuse says so here too, in the same place, so the reason a save is disabled is
 * never further away than the row that caused it.
 */
import {
  CLAIM_ISSUE_LABELS,
  type ClaimIssue,
  type ClaimMapping,
  type ClaimSource,
  sourceInfo,
} from "~/utils/claims";

const props = defineProps<{
  mapping: ClaimMapping;
  issues: readonly ClaimIssue[];
  outcome: ClaimRowOutcome;
  /** Stable across edits, so the name field keeps focus while it is typed into. */
  rowId: string;
}>();

const emit = defineEmits<{
  update: [change: Partial<ClaimMapping>];
  remove: [];
}>();

const nameIssue = computed(() =>
  props.issues.find((issue) => issue.startsWith("name_")),
);
const pathIssue = computed(() =>
  props.issues.find((issue) => issue.startsWith("path_")),
);

/* Whether the row publishes what a browser could not see, said on the outcome line. */
const publishes = computed(() => sourceInfo(props.mapping.source).publishes);

function changeSource(source: ClaimSource, path: string) {
  emit("update", { source, path });
}

const outcomeText = computed(() => {
  const outcome = props.outcome;
  if (outcome.kind === "present") return JSON.stringify(outcome.value);
  if (outcome.kind === "absent") return "Left out of this user's token: nothing to carry.";
  if (outcome.kind === "refused") {
    return "This user could not sign in: the claim is required and there is nothing to carry.";
  }
  return "";
});
</script>

<template>
  <li class="flex flex-col gap-2 px-4 py-3.5">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span class="flex min-w-0 items-center gap-1.5">
        <Icon
          aria-hidden="true"
          class="flex-none text-base text-ink/40"
          name="material-symbols:data-object"
        />
        <v-text-field
          :id="`${rowId}-name`"
          :error="nameIssue !== undefined"
          :model-value="mapping.name"
          aria-label="Claim name"
          autocomplete="off"
          class="claim-name font-mono"
          density="compact"
          hide-details
          placeholder="claim_name"
          spellcheck="false"
          variant="filled"
          @update:model-value="emit('update', { name: String($event) })"
        />
      </span>

      <ClaimSourcePicker
        :id="rowId"
        :invalid="pathIssue !== undefined"
        :path="mapping.path"
        :source="mapping.source"
        @change="changeSource"
        @update:path="emit('update', { path: $event })"
      />

      <span class="ml-auto flex flex-none items-center gap-2">
        <v-tooltip
          location="top"
          max-width="280"
          text="A token without this claim is not issued: the sign-in is refused instead. For a claim your authorisation code branches on, where absent and false would read the same."
        >
          <template #activator="{ props: tip }">
            <label
              v-bind="tip"
              :for="`${rowId}-required`"
              class="flex cursor-pointer items-center gap-1.5 text-[11px] text-ink/70"
            >
              Required
              <v-switch
                :id="`${rowId}-required`"
                :model-value="mapping.required"
                color="primary"
                density="compact"
                hide-details
                inset
                @update:model-value="emit('update', { required: $event === true })"
              />
            </label>
          </template>
        </v-tooltip>
        <v-tooltip location="top" text="Remove this claim">
          <template #activator="{ props: tip }">
            <button
              v-bind="tip"
              :aria-label="`Remove the ${mapping.name || 'unnamed'} claim`"
              class="inline-flex size-7 items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/50 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              type="button"
              @click="emit('remove')"
            >
              <Icon aria-hidden="true" class="text-base" name="material-symbols:close" />
            </button>
          </template>
        </v-tooltip>
      </span>
    </div>

    <p v-if="nameIssue || pathIssue" class="m-0 flex items-start gap-1.5 text-[11px] leading-4 text-error">
      <Icon aria-hidden="true" class="mt-px flex-none text-sm" name="material-symbols:error-outline" />
      <span>{{ CLAIM_ISSUE_LABELS[nameIssue ?? pathIssue ?? "name_empty"] }}</span>
    </p>
    <p
      v-else
      :class="outcome.kind === 'refused' ? 'text-error' : 'text-ink/55'"
      class="m-0 flex items-start gap-1.5 text-[11px] leading-4"
    >
      <Icon
        :name="
          outcome.kind === 'present'
            ? 'material-symbols:arrow-right-alt'
            : outcome.kind === 'refused'
              ? 'material-symbols:block'
              : 'material-symbols:visibility-off-outline'
        "
        aria-hidden="true"
        class="mt-px flex-none text-sm"
      />
      <span v-if="outcome.kind === 'present'" class="min-w-0 truncate">
        <span class="font-mono"><span class="text-ink/60">"{{ mapping.name.trim() }}"</span><span class="text-ink/40">: </span><span class="text-primary">{{ outcomeText }}</span></span>
        <span class="text-ink/45"> · {{ outcome.bytes }} bytes</span>
        <span v-if="publishes" class="text-warning"> · publishes private metadata</span>
      </span>
      <span v-else>{{ outcomeText }}</span>
    </p>
  </li>
</template>

<style scoped>
.claim-name {
  width: 12rem;
}

.claim-name :deep(.v-field__input) {
  font-size: 12px;
  min-height: 28px;
}

:deep(.v-selection-control) {
  --v-selection-control-size: 28px;

  flex: none;
  min-height: 0;
}
</style>

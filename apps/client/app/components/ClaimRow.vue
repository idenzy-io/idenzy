<script lang="ts">
/** What the chosen sample user makes of this mapping, for the line under the row. */
export type ClaimRowOutcome =
  | { kind: "present"; value: unknown; bytes: number }
  | { kind: "absent" }
  | { kind: "refused" }
  | { kind: "invalid" };
</script>

<script setup lang="ts">
/**
 * One mapping in the draft, read as a sentence: the name the token will carry, where it
 * reads from, and whether a token without it is worth issuing.
 *
 * The name and the source are opened in the dialog rather than typed in the row. Four
 * controls fighting for one line is what put a claim's name in a 12rem field that wrapped
 * under its own source at every width the panel is actually read at; a row that states
 * the mapping and hands editing to the form that created it stays one line and stays
 * legible. Required is the exception and stays here, because it is the one field on this
 * screen that can refuse a sign-in and it must be visible without opening anything.
 *
 * Under the sentence is the line that makes the row honest: what this claim becomes for
 * the sample user, in bytes, or why it does not, and what being required costs. A row
 * whose name the server would refuse says so in the same place, so the reason publishing
 * is blocked is never further away than the row that caused it.
 */
import {
  CLAIM_ISSUE_LABELS,
  type ClaimIssue,
  type ClaimMapping,
  claimPathText,
  sourceInfo,
} from "~/utils/claims";

const props = defineProps<{
  mapping: ClaimMapping;
  issues: readonly ClaimIssue[];
  outcome: ClaimRowOutcome;
  /** Stable across edits, so a row keeps its identity while the draft is reordered. */
  rowId: string;
  /** What the outcome line is about, named so a reader knows which user refused. */
  sampleLabel: string;
}>();

const emit = defineEmits<{
  edit: [];
  update: [change: Partial<ClaimMapping>];
  remove: [];
}>();

const issue = computed(() => props.issues[0]);
const source = computed(() => sourceInfo(props.mapping.source));
const name = computed(() => props.mapping.name.trim());

const outcomeText = computed(() => {
  const outcome = props.outcome;
  if (outcome.kind === "absent") return `Nothing to carry for ${props.sampleLabel}, so it is left out.`;
  if (outcome.kind === "refused") {
    return `Required, and ${props.sampleLabel} has nothing to carry: their sign-in is refused.`;
  }
  return "";
});
</script>

<template>
  <li
    class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
  >
    <!-- The mapping, as one sentence: what the token calls it, then where it reads from. -->
    <button
      :aria-label="`Edit the ${name || 'unnamed'} claim`"
      class="group -mx-2 flex min-w-0 items-center gap-2 rounded-(--idenzy-radius-x-small) px-2 py-1 text-left transition-colors duration-150 hover:bg-ink/4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      type="button"
      @click="emit('edit')"
    >
      <span
        :class="issue ? 'font-mono text-error' : 'font-mono text-ink'"
        class="truncate text-[13px] font-medium"
      >
        {{ name || "unnamed" }}
      </span>
      <Icon
        aria-hidden="true"
        class="flex-none text-sm text-ink/30"
        name="material-symbols:arrow-right-alt"
      />
      <span class="flex min-w-0 items-center gap-1.5">
        <Icon
          :class="source.publishes ? 'text-warning' : 'text-ink/45'"
          :name="source.icon"
          aria-hidden="true"
          class="flex-none text-sm"
        />
        <span
          :class="source.publishes ? 'text-warning' : 'text-ink/65'"
          class="truncate font-mono text-[11px]"
        >
          {{ claimPathText(mapping) }}
        </span>
      </span>
      <Icon
        aria-hidden="true"
        class="ml-0.5 flex-none text-sm text-ink/0 transition-colors duration-150 group-hover:text-ink/50 group-focus-visible:text-ink/50"
        name="material-symbols:edit-outline"
      />
    </button>

    <!-- Required keeps the words beside it: a switch alone in a row of claims is a state
         nobody can name, and this is the one that decides whether a sign-in happens. -->
    <label
      :for="`${rowId}-required`"
      class="col-start-1 row-start-2 flex w-fit cursor-pointer items-center gap-1.5 text-[11px] font-medium sm:col-start-2 sm:row-start-1"
    >
      <v-switch
        :id="`${rowId}-required`"
        :model-value="mapping.required"
        color="primary"
        density="compact"
        hide-details
        inset
        @update:model-value="emit('update', { required: $event === true })"
      />
      <span :class="mapping.required ? 'text-ink' : 'text-ink/50'">
        {{ mapping.required ? "Required" : "Optional" }}
      </span>
    </label>

    <button
      :aria-label="`Remove the ${name || 'unnamed'} claim`"
      class="col-start-2 row-start-1 inline-flex size-7 items-center justify-center justify-self-end rounded-(--idenzy-radius-x-small) text-ink/45 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:col-start-3"
      type="button"
      @click="emit('remove')"
    >
      <Icon aria-hidden="true" class="text-base" name="material-symbols:close" />
      <v-tooltip activator="parent" location="top" text="Remove from the draft" />
    </button>

    <p
      v-if="issue"
      class="col-span-full m-0 flex items-start gap-1.5 text-[11px] leading-4 text-error"
    >
      <Icon
        aria-hidden="true"
        class="mt-px flex-none text-sm"
        name="material-symbols:error-outline"
      />
      <span>{{ CLAIM_ISSUE_LABELS[issue] }}</span>
    </p>
    <p
      v-else
      :class="outcome.kind === 'refused' ? 'text-error' : 'text-ink/55'"
      class="col-span-full m-0 flex items-start gap-1.5 text-[11px] leading-4"
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
        <span class="font-mono"><span class="text-ink/60">"{{ name }}"</span><span class="text-ink/40">: </span><span class="text-primary">{{ JSON.stringify(outcome.value) }}</span></span>
        <span class="text-ink/45"> · {{ outcome.bytes }} bytes</span>
        <span v-if="mapping.required" class="text-ink/45">
          · required, so an account without it cannot sign in</span>
        <span v-if="source.publishes" class="text-warning"> · publishes private metadata</span>
      </span>
      <span v-else>{{ outcomeText }}</span>
    </p>
  </li>
</template>

<style scoped>
/* Vuetify's selection control is a grid item with a name and grows to fill a flex row;
   neither is wanted in a label of two words. */
:deep(.v-selection-control) {
  --v-selection-control-size: 28px;

  flex: none;
  min-height: 0;
}
</style>

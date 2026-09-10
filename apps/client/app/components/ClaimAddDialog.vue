<script setup lang="ts">
/**
 * Adds one claim, as a short form: where it reads from, which field or key, what the
 * token calls it, and whether a token without it is worth issuing. Four controls in
 * that order, labels above, one line of help each, and a preview of what the claim
 * becomes before it is added.
 *
 * The defaults are the common case. The profile's email is chosen and named the moment
 * the dialog opens, so the simplest claim is two clicks, and everything else is one
 * change away. What is conditional appears only when it applies: the key field for a
 * metadata source, and the note that private metadata is published. Explanations that
 * are not needed to fill the form in sit behind an info glyph rather than on the page.
 *
 * The name is checked as it is typed, because reserved and taken names are the kind of
 * mistake worth stopping early, but only once something has been typed: an empty field
 * is not yet wrong.
 */
import {
  CLAIM_ISSUE_LABELS,
  type ClaimMapping,
  type ClaimSource,
  defaultClaimName,
  resolveClaim,
  type SampleUser,
  SOURCES,
  USER_FIELDS,
  userFieldInfo,
  validateName,
  validatePath,
} from "~/utils/claims";

const props = defineProps<{
  /** The mappings already in the template, for the duplicate check. */
  existing: readonly ClaimMapping[];
  /** The user the preview line renders against. */
  sample: SampleUser;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  add: [mapping: ClaimMapping];
}>();

const source = ref<ClaimSource>("user");
const path = ref("email");
const name = ref("email");
const required = ref(false);
/* Once the name has been typed into, a change of field no longer overwrites it. */
const nameTouched = ref(false);
const keyTouched = ref(false);

const taken = computed(() => props.existing.map((claim) => claim.name.trim()));

watch(open, (value) => {
  if (!value) return;
  source.value = "user";
  path.value = "email";
  required.value = false;
  nameTouched.value = false;
  keyTouched.value = false;
  name.value = defaultClaimName("email", taken.value);
});

const SOURCE_OPTIONS = SOURCES.map((info) => ({
  value: info.source,
  label: info.source === "user" ? "Profile" : info.label,
}));

const sourceModel = computed({
  get: () => source.value,
  set: (next: string) => {
    if (next !== "user" && next !== "metadata_public" && next !== "metadata_private") return;
    if (next === source.value) return;
    source.value = next;
    path.value = next === "user" ? "email" : "";
    keyTouched.value = false;
    if (!nameTouched.value) name.value = defaultClaimName(path.value, taken.value);
  },
});

const publishes = computed(() => source.value === "metadata_private");
const field = computed(() => (source.value === "user" ? userFieldInfo(path.value) : null));

function chooseField(next: string) {
  path.value = next;
  if (!nameTouched.value) name.value = defaultClaimName(next, taken.value);
}

function typeKey(next: string) {
  path.value = next;
  keyTouched.value = true;
  if (!nameTouched.value) name.value = defaultClaimName(next, taken.value);
}

function typeName(next: string) {
  name.value = next;
  nameTouched.value = true;
}

const nameIssue = computed(() => validateName(name.value, taken.value)[0]);
const pathIssue = computed(() => validatePath(source.value, path.value)[0]);
const ready = computed(() => nameIssue.value === undefined && pathIssue.value === undefined);

/* Shown only once something has been typed: an empty field is not yet wrong. */
const nameError = computed(() => (name.value.trim() === "" ? undefined : nameIssue.value));
const keyError = computed(() =>
  !keyTouched.value || path.value.trim() === "" ? undefined : pathIssue.value,
);

/* What the claim would be for the sample, as the row will show it once added. */
const preview = computed(() => {
  if (!ready.value) return null;
  const value = resolveClaim(
    { name: name.value.trim(), source: source.value, path: path.value.trim(), required: false },
    props.sample,
  );
  return value === undefined || value === null ? null : JSON.stringify(value);
});

function confirm() {
  if (!ready.value) return;
  emit("add", {
    name: name.value.trim(),
    source: source.value,
    path: path.value.trim(),
    required: required.value,
  });
  /* Cleared before the fade, or the list it just joined reports the name as already mapped. */
  name.value = "";
  path.value = "";
  open.value = false;
}
</script>

<template>
  <v-dialog v-model="open" max-width="440">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Add a claim</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            One value carried in every access token this project issues.
          </p>
        </header>

        <div class="flex flex-col gap-2">
          <span class="text-xs font-medium text-ink">Reads from</span>
          <SegmentedControl v-model="sourceModel" :options="SOURCE_OPTIONS" label="Source" stretch />
          <p
            v-if="publishes"
            class="m-0 flex items-start gap-1.5 text-[11px] leading-4 text-warning"
            role="status"
          >
            <Icon aria-hidden="true" class="mt-px flex-none text-sm" name="material-symbols:lock-open-outline" />
            Publishes what a browser could not see. Saving will ask you to acknowledge it.
          </p>
        </div>

        <div v-if="source === 'user'" class="flex flex-col gap-1">
          <label class="text-xs font-medium text-ink" for="claim-add-field">Field</label>
          <!-- Drawn like the filled fields beside it: a tinted box with a rule along its
               foot, so a list and a line of text read as the same kind of control. -->
          <button
            id="claim-add-field"
            aria-haspopup="menu"
            class="group flex h-9 w-full items-center justify-between gap-2 rounded-t-(--idenzy-radius) border-b border-ink/25 bg-ink/5 px-3 text-left text-sm text-ink transition-colors duration-150 hover:border-ink/45 hover:bg-ink/8 focus-visible:border-primary focus-visible:outline-none"
            type="button"
          >
            <span class="flex min-w-0 items-center gap-2">
              <Icon v-if="field" :name="field.icon" aria-hidden="true" class="flex-none text-base text-ink/55" />
              <span class="truncate">{{ field?.label ?? "Choose a field" }}</span>
              <span v-if="field" class="font-mono text-[11px] text-ink/45">{{ field.field }}</span>
            </span>
            <Icon
              aria-hidden="true"
              class="flex-none text-base text-ink/45 transition-colors duration-150 group-hover:text-ink/80"
              name="material-symbols:unfold-more"
            />
            <v-menu :offset="6" activator="parent" location="bottom center">
              <v-list density="compact" nav width="400">
                <v-list-item
                  v-for="option in USER_FIELDS"
                  :key="option.field"
                  :active="option.field === path"
                  :prepend-icon="option.icon"
                  :subtitle="option.note"
                  :title="option.label"
                  @click="chooseField(option.field)"
                >
                  <template #append>
                    <span class="font-mono text-[10px] text-ink/45">{{ option.field }}</span>
                  </template>
                </v-list-item>
              </v-list>
            </v-menu>
          </button>
          <p class="m-0 text-[11px] leading-4 text-ink/50">
            {{ field?.note ?? "Nine fields of the public profile, and no others." }}
          </p>
        </div>

        <div v-else class="flex flex-col gap-1">
          <label class="text-xs font-medium text-ink" for="claim-add-key">Key</label>
          <v-text-field
            id="claim-add-key"
            :error="keyError !== undefined"
            :model-value="path"
            autocomplete="off"
            class="font-mono"
            hide-details
            placeholder="plan"
            spellcheck="false"
            variant="filled"
            @update:model-value="typeKey(String($event))"
          />
          <p :class="keyError ? 'text-error' : 'text-ink/50'" class="m-0 text-[11px] leading-4">
            {{ keyError ? CLAIM_ISSUE_LABELS[keyError] : "A top-level key. Nested values are not reached." }}
          </p>
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-ink" for="claim-add-name">Name in the token</label>
          <v-text-field
            id="claim-add-name"
            :error="nameError !== undefined"
            :model-value="name"
            autocomplete="off"
            class="font-mono"
            hide-details
            placeholder="claim_name"
            spellcheck="false"
            variant="filled"
            @update:model-value="typeName(String($event))"
          />
          <p :class="nameError ? 'text-error' : 'text-ink/50'" class="m-0 text-[11px] leading-4">
            {{ nameError ? CLAIM_ISSUE_LABELS[nameError] : "The key your code reads off the token." }}
          </p>
          <label class="mt-1.5 flex w-fit cursor-pointer items-center gap-1.5 text-xs text-ink">
            <v-checkbox-btn v-model="required" color="primary" density="compact" />
            Required
            <v-tooltip
              location="top"
              max-width="260"
              text="A token without this claim is not issued: the sign-in is refused instead. For a claim your authorisation code branches on, where absent and false would read the same."
            >
              <template #activator="{ props: tip }">
                <Icon
                  v-bind="tip"
                  aria-label="What required means"
                  class="flex-none text-sm text-ink/40"
                  name="material-symbols:info-outline"
                  role="img"
                />
              </template>
            </v-tooltip>
          </label>
        </div>

        <SamplePanel meta="For a complete profile" title="In the token">
          <SampleLine v-if="!ready" icon="material-symbols:edit-outline" tone="muted">
            Finish the form to see what the token carries.
          </SampleLine>
          <SampleLine
            v-else-if="preview === null"
            :tone="required ? 'error' : 'muted'"
            icon="material-symbols:visibility-off-outline"
          >
            {{ required ? "Nothing to carry, so this user's sign-in would be refused." : "Nothing to carry, so it is left out." }}
          </SampleLine>
          <SampleLine v-else :name="name.trim()" :value="preview" icon="material-symbols:arrow-right-alt" />
        </SamplePanel>

        <footer class="flex items-center justify-end gap-2">
          <v-btn class="text-xs font-medium" color="neutral" size="small" variant="text" @click="open = false">
            Cancel
          </v-btn>
          <v-btn :disabled="!ready" class="text-xs font-medium" color="primary" size="small" type="submit" variant="flat">
            Add claim
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>

<style scoped>
:deep(.v-selection-control) {
  --v-selection-control-size: 24px;

  flex: none;
  min-height: 0;
}
</style>

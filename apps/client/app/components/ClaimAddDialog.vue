<script setup lang="ts">
/**
 * The form that puts a claim in the draft, and the same form that changes one: where it
 * reads from, which field or key, what the token calls it, and whether a token without
 * it is worth issuing. Four controls in that order, labels above, one line of help each.
 *
 * Its footer says **Add to draft**, never Add or Save, because this dialog writes
 * nothing: the template is published whole from the page's toolbar, and a first button
 * that looks like publication is the misreading this screen exists to prevent.
 *
 * `mapping` is the row being edited, or null to add. Editing reuses this form rather
 * than a second one so the rules are stated once; what changes is the title, the footer
 * and which name the duplicate check is allowed to ignore.
 *
 * The preview is one line per sample user rather than one line for a complete profile.
 * A required claim is the only control on this screen that can refuse a sign-in, and a
 * template judged against a synthetic complete profile is exactly how that ships.
 */
import {
  CLAIM_ISSUE_LABELS,
  type ClaimMapping,
  type ClaimSource,
  defaultClaimName,
  type RenderedTemplate,
  renderTemplate,
  resolveClaim,
  SAMPLE_PROFILES,
  SOURCES,
  tokenLines,
  USER_FIELDS,
  userFieldInfo,
  validateName,
  validatePath,
} from "~/utils/claims";

const props = withDefaults(
  defineProps<{
    /** The mappings already in the draft, for the duplicate check. */
    existing: readonly ClaimMapping[];
    /** The row being edited, or null to add a new one. */
    mapping?: ClaimMapping | null;
  }>(),
  { mapping: null },
);

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  /** Into the draft, never to the server. */
  submit: [mapping: ClaimMapping];
}>();

const editing = computed(() => props.mapping !== null);

const source = ref<ClaimSource>("user");
const path = ref("email");
const name = ref("email");
const required = ref(false);
/* Once the name has been typed into, a change of field no longer overwrites it. */
const nameTouched = ref(false);
const keyTouched = ref(false);

/* The row being edited keeps its own name: it is not a duplicate of itself. */
const taken = computed(() =>
  props.existing.filter((claim) => claim !== props.mapping).map((claim) => claim.name.trim()),
);

watch(open, (value) => {
  if (!value) return;
  const current = props.mapping;
  source.value = current?.source ?? "user";
  path.value = current?.path ?? "email";
  required.value = current?.required ?? false;
  nameTouched.value = current !== null;
  keyTouched.value = current !== null;
  name.value = current?.name ?? defaultClaimName("email", taken.value);
});

const SOURCE_OPTIONS = SOURCES.map((info) => ({
  value: info.source,
  label: info.source === "user" ? "Profile" : info.label,
}));

const REQUIRED_OPTIONS = [
  { value: "optional", label: "Optional" },
  { value: "required", label: "Required" },
];

const requiredModel = computed({
  get: () => (required.value ? "required" : "optional"),
  set: (next: string) => {
    required.value = next === "required";
  },
});

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

/* Shown only once something has been typed: an untouched blank field is not yet wrong. */
const nameError = computed(() => (name.value.trim() === "" ? undefined : nameIssue.value));
const keyError = computed(() =>
  !keyTouched.value || path.value.trim() === "" ? undefined : pathIssue.value,
);

const draft = computed<ClaimMapping>(() => ({
  name: name.value.trim(),
  source: source.value,
  path: path.value.trim(),
  required: required.value,
}));

/*
 * The token this claim would produce, as the token: the same JSON block, the same marks
 * and the same Shiki palette as the preview on the page behind it.
 *
 * The row of labelled values this replaced said `"plan": "pro"` beside a sample's name
 * and expected the reader to assemble a token in their head. A claim is a line in a
 * payload their own code reads, so the honest way to describe one is to show the payload
 * with the line in it, marked as the line this dialog adds. The assembled claims are
 * left out: `iss` and `aud` are seven lines of the issuer's business, and this block is
 * about the part of the token that is theirs.
 */
const sampleId = ref<string>("complete");
const SAMPLE_OPTIONS = SAMPLE_PROFILES.map((profile) => ({
  value: profile.id,
  label: profile.short,
  title: profile.label,
}));
const sample = computed(
  () => SAMPLE_PROFILES.find((profile) => profile.id === sampleId.value) ?? SAMPLE_PROFILES[0],
);

/** The draft's claims with this one added, or replacing the row being edited. */
const nextClaims = computed<ClaimMapping[]>(() =>
  props.mapping === null
    ? [...props.existing, draft.value]
    : props.existing.map((claim) => (claim === props.mapping ? draft.value : claim)),
);

const EMPTY_RENDER: RenderedTemplate = {
  present: [],
  absent: [],
  refusedBy: null,
  bytes: 2,
  overBudget: false,
};

const before = computed(() => {
  const user = sample.value?.user;
  return user === undefined ? EMPTY_RENDER : renderTemplate(props.existing, user);
});
const after = computed(() => {
  const user = sample.value?.user;
  return user === undefined ? EMPTY_RENDER : renderTemplate(nextClaims.value, user);
});
const previewLines = computed(() => tokenLines({}, after.value, before.value));

/**
 * The sample users this claim finds nothing for, which is the whole of what `required`
 * decides. Named in full because "a new account" is a person the reader has, and
 * "sparse" is not.
 */
const missingFor = computed(() =>
  ready.value
    ? SAMPLE_PROFILES.filter((profile) => {
        const value = resolveClaim(draft.value, profile.user);
        return value === undefined || value === null;
      })
    : [],
);

const missingNames = computed(() =>
  missingFor.value.map((profile) => profile.label.toLowerCase()).join(" and "),
);
const missingVerb = computed(() => (missingFor.value.length === 1 ? "has" : "have"));

function submit() {
  if (!ready.value) return;
  emit("submit", draft.value);
  /* Cleared before the fade, or the list it just joined reports the name as taken. */
  name.value = "";
  path.value = "";
  open.value = false;
}
</script>

<template>
  <v-dialog v-model="open" max-width="480">
    <v-card aria-labelledby="claim-form-title" border flat role="dialog">
      <form class="flex flex-col gap-5 p-5" @submit.prevent="submit">
        <header class="flex flex-col gap-1">
          <h2 id="claim-form-title" class="m-0 text-sm font-medium text-ink">
            {{ editing ? `Edit the ${mapping?.name.trim() || "unnamed"} claim` : "Add a claim" }}
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            One value carried in every access token this project issues. Nothing here is
            published until the template is.
          </p>
        </header>

        <div class="flex flex-col gap-2">
          <span class="text-xs font-medium text-ink">Reads from</span>
          <SegmentedControl
            v-model="sourceModel"
            :options="SOURCE_OPTIONS"
            label="Source"
            stretch
          />
          <p
            v-if="publishes"
            class="m-0 flex items-start gap-1.5 text-[11px] leading-4 text-warning"
            role="status"
          >
            <Icon
              aria-hidden="true"
              class="mt-px flex-none text-sm"
              name="material-symbols:lock-open-outline"
            />
            Publishes what a browser could not see. Publishing the template will ask you to
            acknowledge it, once.
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
              <Icon
                v-if="field"
                :name="field.icon"
                aria-hidden="true"
                class="flex-none text-base text-ink/55"
              />
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
            {{
              keyError
                ? CLAIM_ISSUE_LABELS[keyError]
                : "A top-level key. Nested values are not reached."
            }}
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
        </div>

        <!-- The one choice here with a consequence, so the consequence is written out
             rather than parked behind a glyph. -->
        <div class="flex flex-col gap-2">
          <span class="text-xs font-medium text-ink">When the user has nothing there</span>
          <SegmentedControl
            v-model="requiredModel"
            :options="REQUIRED_OPTIONS"
            label="Required"
            stretch
          />
          <p class="m-0 text-[11px] leading-4 text-ink/50">
            <template v-if="required">
              The token is not issued at all: the sign-in is refused with
              <span class="font-mono text-ink/70">claim_template_unsatisfied</span>. Choose this
              only where your authorisation code branches on the claim, and absent would read
              the same as false.
            </template>
            <template v-else>
              The claim is left out of that user's token and the sign-in goes ahead. Absent,
              never null.
            </template>
          </p>
        </div>

        <!-- The claim as the thing it actually is: a line in the payload the customer's
             own code reads, marked as the line this dialog would add to it. -->
        <div class="flex flex-col gap-2">
          <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <span class="text-xs font-medium text-ink">Your claims in this user's token</span>
            <SegmentedControl v-model="sampleId" :options="SAMPLE_OPTIONS" label="Sample user" />
          </div>

          <div
            class="overflow-hidden rounded-(--idenzy-radius-small) bg-ink/4 ring-1 ring-ink/6 ring-inset"
          >
            <p
              v-if="!ready"
              class="m-0 flex items-start gap-2 px-4 py-3 text-xs leading-5 text-ink/55"
            >
              <Icon
                aria-hidden="true"
                class="mt-0.5 flex-none text-base text-ink/45"
                name="material-symbols:edit-outline"
              />
              Finish the form to see what the token carries.
            </p>
            <p
              v-else-if="previewLines.length === 0"
              class="m-0 flex items-start gap-2 px-4 py-3 text-xs leading-5 text-ink/55"
            >
              <Icon
                aria-hidden="true"
                class="mt-0.5 flex-none text-base text-ink/45"
                name="material-symbols:visibility-off-outline"
              />
              This user has nothing for any of your claims, so their token carries none of
              them. Everything the issuer assembles is still there.
            </p>
            <ClaimTokenPreview v-else :lines="previewLines" :rendered="after" />
          </div>

          <!-- The first half explains a fragment, so it goes when there is no fragment to
               explain; the second is about the claim and holds whoever is being previewed. -->
          <p class="m-0 text-[11px] leading-4 text-ink/50">
            <template v-if="after.refusedBy === null">
              The claims we assemble are not shown: <span class="font-mono">iss</span>,
              <span class="font-mono">sub</span>, <span class="font-mono">aud</span> and the rest
              are in every token whatever your template says.
            </template>
            <span v-if="ready" class="text-ink/70">
              Your code reads this one as
              <span class="font-mono">claims.{{ name.trim() }}</span>.
            </span>
          </p>
        </div>

        <p
          v-if="missingFor.length > 0"
          :class="required ? 'text-error' : 'text-ink/60'"
          class="m-0 flex items-start gap-1.5 text-[11px] leading-4"
          role="status"
        >
          <Icon
            :name="
              required ? 'material-symbols:block' : 'material-symbols:visibility-off-outline'
            "
            aria-hidden="true"
            class="mt-px flex-none text-sm"
          />
          <span v-if="required">
            {{ missingNames }} {{ missingVerb }} nothing here, so this claim refuses their sign-in
            altogether. Real accounts look like these.
          </span>
          <span v-else>
            {{ missingNames }} {{ missingVerb }} nothing here, so the claim is left out of their token and
            they sign in as usual.
          </span>
        </p>

        <footer class="flex items-center justify-end gap-2">
          <v-btn
            class="text-xs font-medium"
            color="neutral"
            size="small"
            variant="text"
            @click="open = false"
          >
            Cancel
          </v-btn>
          <v-btn
            :disabled="!ready"
            class="text-xs font-medium"
            color="primary"
            size="small"
            type="submit"
            variant="flat"
          >
            {{ editing ? "Save to draft" : "Add to draft" }}
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>

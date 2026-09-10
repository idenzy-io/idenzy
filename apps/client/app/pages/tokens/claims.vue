<script setup lang="ts">
/**
 * Claim templates: what this project's access tokens carry beyond the claims we assemble
 * (PROJECT.md 4.2, apps/auth-api/src/claims). An editor on the left and the token it
 * produces on the right, because a template is abstract until it meets a user and the
 * place to be surprised by what a token says is here and not in production.
 *
 * Unlike the settings screens this one holds a draft and saves it whole. That is the
 * server's shape and not a preference: the byte budget is on the total, so a change to
 * one claim is only checkable against every other, and `PUT` is the only verb the
 * management API offers. The draft is kept per project, so switching projects and back
 * does not lose an edit, and leaving the screen with one asks first.
 *
 * Every rule the save applies is applied here first, from the same lists the server
 * reads (`@idenzy/protocol/schemas/claims`), so the save button is disabled for exactly
 * the template the server would refuse and the row that caused it says why. The one
 * rule that is a question rather than a check, publishing private metadata, is asked
 * at save, once, and what the server records is when it was answered.
 */
import type { ClaimRowOutcome } from "~/components/ClaimRow.vue";
import {
  assembledClaims,
  type ClaimMapping,
  type ClaimTemplate,
  copyTemplate,
  isSameTemplate,
  MAX_CLAIM_BYTES,
  MAX_CLAIMS,
  namesBytes,
  RESERVED_CLAIMS,
  readsPrivateMetadata,
  renderTemplate,
  SAMPLE_PROFILES,
  TEMPLATE_ISSUE_LABELS,
  USER_FIELDS,
  validateMapping,
  validateTemplate,
} from "~/utils/claims";
import { formatDateTime, relativeTimeWords } from "~/utils/time";

const projects = useProjectStore();
const store = useClaimsStore();
const router = useRouter();

const saved = computed(() => store.templateFor(projects.current.id));

/*
 * The draft, one per project, seeded from what is saved the first time a project is
 * looked at after the template has loaded. Mappings are edited in place rather than
 * replaced, so a row keeps its identity, and its focus, while a name is typed into it.
 */
const drafts = ref<Record<string, ClaimTemplate>>({});

watch(
  [() => projects.current.id, () => store.loading],
  ([projectId, loading]) => {
    if (loading || drafts.value[projectId] !== undefined) return;
    drafts.value = { ...drafts.value, [projectId]: copyTemplate(store.templateFor(projectId)) };
  },
  { immediate: true },
);

const draft = computed<ClaimTemplate>(
  () => drafts.value[projects.current.id] ?? copyTemplate(saved.value),
);

function replaceDraft(next: ClaimTemplate) {
  drafts.value = { ...drafts.value, [projects.current.id]: next };
}

/* Row keys that survive an edit: the mapping object itself is what a row is. */
const rowIds = new WeakMap<object, string>();
let nextRowId = 0;

function rowId(claim: ClaimMapping): string {
  const raw = toRaw(claim);
  let id = rowIds.get(raw);
  if (id === undefined) {
    id = `claim-${nextRowId}`;
    nextRowId += 1;
    rowIds.set(raw, id);
  }
  return id;
}

/* Adding goes through a dialog, because the first choice is the one with consequences. */
const addDialog = ref(false);
const full = computed(() => draft.value.claims.length >= MAX_CLAIMS);

function addClaim(mapping: ClaimMapping) {
  if (full.value) return;
  draft.value.claims.push({ ...mapping });
}

function updateClaim(index: number, change: Partial<ClaimMapping>) {
  const claim = draft.value.claims[index];
  if (claim === undefined) return;
  Object.assign(claim, change);
}

function removeClaim(index: number) {
  draft.value.claims.splice(index, 1);
}

/*
 * Validity, from the same rules the server applies. The acknowledgement is the one
 * issue that does not disable the save: it is asked for at save instead.
 */
const mappingIssues = computed(() =>
  draft.value.claims.map((_, index) => validateMapping(draft.value.claims, index)),
);
const templateIssues = computed(() => validateTemplate(draft.value));
const blockingIssues = computed(() =>
  templateIssues.value.filter((issue) => issue !== "private_unacknowledged"),
);
const mappingsValid = computed(() => mappingIssues.value.every((issues) => issues.length === 0));
const dirty = computed(() => !isSameTemplate(draft.value, saved.value));
const canSave = computed(
  () => dirty.value && mappingsValid.value && blockingIssues.value.length === 0 && !saving.value,
);

const privateClaims = computed(() =>
  draft.value.claims.filter((claim) => claim.source === "metadata_private"),
);
const readsPrivate = computed(() => readsPrivateMetadata(draft.value.claims));

/*
 * Saving. The acknowledgement dialog stands in front of a save that reads private
 * metadata without one, and confirming it is what saves.
 */
const saving = ref(false);
const acknowledgeDialog = ref(false);

async function save() {
  if (!canSave.value) return;
  if (readsPrivate.value && !draft.value.acknowledgePrivateMetadata) {
    acknowledgeDialog.value = true;
    return;
  }
  await commit();
}

function acknowledgeAndSave() {
  draft.value.acknowledgePrivateMetadata = true;
  void commit();
}

async function commit() {
  const projectId = projects.current.id;
  saving.value = true;
  try {
    const stored = await store.save(projectId, draft.value);
    drafts.value = { ...drafts.value, [projectId]: copyTemplate(stored) };
  } finally {
    saving.value = false;
  }
}

function discard() {
  replaceDraft(copyTemplate(saved.value));
}

/* Cmd+S and Ctrl+S save, because an editor with a save button is expected to. */
useEventListener(window, "keydown", (event: KeyboardEvent) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void save();
  }
});

/* Leaving with a draft asks first, and discarding is what lets the navigation through. */
const leaveDialog = ref(false);
const leavingTo = ref<string | null>(null);

onBeforeRouteLeave((to) => {
  if (!dirty.value || leavingTo.value !== null) return true;
  leavingTo.value = to.fullPath;
  leaveDialog.value = true;
  return false;
});

function discardAndLeave() {
  const target = leavingTo.value;
  discard();
  if (target !== null) void router.push(target);
}

watch(leaveDialog, (open) => {
  if (!open && leavingTo.value !== null && dirty.value) leavingTo.value = null;
});

/*
 * The preview: the draft rendered for a sample user, as the issuer would render it.
 */
const profileId = ref<string>("complete");
const profile = computed(
  () => SAMPLE_PROFILES.find((entry) => entry.id === profileId.value) ?? SAMPLE_PROFILES[0],
);
const PROFILE_OPTIONS = SAMPLE_PROFILES.map((entry) => ({
  value: entry.id,
  label: entry.label,
  icon: entry.icon,
}));

/* Held still for the visit, so the issued-at claim does not tick under the reader. */
const issuedAt = new Date();

const rendered = computed(() => {
  const user = profile.value?.user;
  return user === undefined
    ? { present: [], absent: [], refusedBy: null, bytes: 2, overBudget: false }
    : renderTemplate(draft.value.claims, user);
});
const assembled = computed(() => {
  const user = profile.value?.user;
  return user === undefined ? {} : assembledClaims(user, projects.current.id, issuedAt);
});

function outcomeOf(index: number): ClaimRowOutcome {
  const claim = draft.value.claims[index];
  if (claim === undefined || (mappingIssues.value[index]?.length ?? 0) > 0)
    return { kind: "invalid" };
  if (rendered.value.refusedBy === claim) return { kind: "refused" };
  if (rendered.value.absent.includes(claim)) return { kind: "absent" };
  const hit = rendered.value.present.find((entry) => entry.name === claim.name.trim());
  return hit === undefined
    ? { kind: "invalid" }
    : { kind: "present", value: hit.value, bytes: hit.bytes };
}

const nameBytes = computed(() => namesBytes(draft.value.claims));

/* The line in the header that says where the template stands. */
const now = useNow({ interval: 30_000 });
const savedAgo = computed(() => {
  const at = saved.value.updatedAt;
  if (at === null) return "";
  const stamp = new Date(at);
  return relativeTimeWords(at, now.value < stamp ? stamp : now.value);
});

const GUIDES = [
  {
    icon: "material-symbols:token-outline",
    title: "Claim templates",
    detail: "Sources, required claims, and what the budget is for.",
    href: "https://idenzy.dev/docs/tokens/claims",
  },
  {
    icon: "material-symbols:code",
    title: "Reading claims on your server",
    detail: "The claims field in @idenzy/node, and branching on it safely.",
    href: "https://idenzy.dev/docs/sdk/node/claims",
  },
  {
    icon: "material-symbols:data-object",
    title: "Public and private metadata",
    detail: "Which column to write to, and who can read each.",
    href: "https://idenzy.dev/docs/users/metadata",
  },
  {
    icon: "material-symbols:database",
    title: "Token claims in Postgres policies",
    detail: "Using a claim inside row-level security without a lookup.",
    href: "https://idenzy.dev/docs/tokens/rls",
  },
];
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:token-outline" title="Claim templates">
      <template #description>
        What
        <span class="font-medium text-ink">{{ projects.current.name }}</span>'s access tokens
        carry beyond the claims we assemble. Your authorisation code reads them off the
        token with no lookup. Saved as one, because the budget is on the whole.
      </template>
      <template #actions>
        <span class="flex items-center gap-1.5 text-xs text-ink/55">
          <template v-if="saving">
            <Icon aria-hidden="true" class="animate-spin text-sm" name="material-symbols:progress-activity" />
            Saving
          </template>
          <template v-else-if="dirty">
            <span aria-hidden="true" class="size-1.5 rounded-full bg-warning" />
            Unsaved changes
          </template>
          <template v-else-if="saved.updatedAt">
            <span aria-hidden="true" class="size-1.5 rounded-full bg-success" />
            <v-tooltip :text="formatDateTime(saved.updatedAt)" location="top">
              <template #activator="{ props: tip }">
                <span v-bind="tip">Saved {{ savedAgo }}</span>
              </template>
            </v-tooltip>
          </template>
          <template v-else>
            <span aria-hidden="true" class="size-1.5 rounded-full bg-ink/30" />
            Nothing saved yet
          </template>
        </span>
        <v-btn
          v-if="dirty && !saving"
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:undo"
          size="small"
          variant="text"
          @click="discard"
        >
          Discard
        </v-btn>
        <FancyButton :disabled="!canSave" @click="save">
          <Icon
            :class="saving ? 'animate-spin' : ''"
            :name="saving ? 'material-symbols:progress-activity' : 'material-symbols:save-outline'"
            aria-hidden="true"
            class="text-sm"
          />
          Save template
        </FancyButton>
      </template>
    </PageHeader>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
      <div class="flex min-w-0 flex-col gap-6">
        <LayerCard
          :padded="false"
          description="Each row is one claim: what the token calls it, where it reads from, and whether a token without it is worth issuing."
          title="Claims"
        >
          <template #badge>
            <StatusBadge
              :label="`${draft.claims.length} of ${MAX_CLAIMS}`"
              :tone="draft.claims.length > MAX_CLAIMS ? 'error' : 'neutral'"
            />
          </template>
          <p v-if="store.loading" class="m-0 px-4 py-8 text-center text-xs text-ink/50">
            Reading the template.
          </p>

          <EmptyState
            v-else-if="draft.claims.length === 0"
            description="Add a claim to carry a profile field or a metadata key in every access token, where your authorisation code reads it without a lookup. Until then a token carries only what we assemble."
            icon="material-symbols:token-outline"
            title="Tokens carry only what we assemble"
          >
            <template #actions>
              <FancyButton @click="addDialog = true">
                <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
                Add claim
              </FancyButton>
            </template>
          </EmptyState>

          <template v-else>
            <ul class="m-0 list-none divide-y divide-line p-0">
              <ClaimRow
                v-for="(claim, index) in draft.claims"
                :key="rowId(claim)"
                :issues="mappingIssues[index] ?? []"
                :mapping="claim"
                :outcome="outcomeOf(index)"
                :row-id="rowId(claim)"
                @remove="removeClaim(index)"
                @update="updateClaim(index, $event)"
              />
            </ul>
            <!-- The one way to add, at the foot of the list where the next row would go. -->
            <div class="border-t border-line px-3 py-2">
              <v-tooltip :disabled="!full" :text="`A template holds at most ${MAX_CLAIMS} claims.`" location="top">
                <template #activator="{ props: tip }">
                  <span v-bind="tip" class="inline-flex">
                    <button
                      :disabled="full"
                      class="inline-flex h-8 items-center gap-1.5 rounded-(--idenzy-radius-x-small) px-2 text-xs font-medium text-ink/70 transition-colors duration-150 hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-40"
                      type="button"
                      @click="addDialog = true"
                    >
                      <Icon aria-hidden="true" class="text-base" name="material-symbols:add" />
                      Add claim
                    </button>
                  </span>
                </template>
              </v-tooltip>
            </div>
          </template>

          <div v-if="!store.loading && draft.claims.length > 0" class="flex flex-col gap-4 border-t border-line bg-canvas/60 px-4 py-4">
            <div
              v-if="readsPrivate"
              class="flex items-start gap-3 rounded-(--idenzy-radius-small) border border-warning/40 bg-warning/6 px-4 py-3"
            >
              <Icon aria-hidden="true" class="mt-px flex-none text-base text-warning" name="material-symbols:lock-open-outline" />
              <div class="flex flex-col gap-0.5 text-xs">
                <p class="m-0 font-medium text-ink">This template publishes private metadata</p>
                <p class="m-0 leading-5 text-ink/70">
                  {{ privateClaims.length === 1 ? "One claim reads" : `${privateClaims.length} claims read` }}
                  <span class="font-mono text-ink/85">metadata_private</span>, which nothing
                  outside the management API has seen until now.
                  <template v-if="draft.acknowledgePrivateMetadata">
                    Acknowledged, and the time it was given is stored with the template.
                  </template>
                  <template v-else>
                    Saving will ask you to acknowledge it.
                  </template>
                </p>
              </div>
            </div>

            <ul v-if="blockingIssues.length > 0" class="m-0 flex list-none flex-col gap-1 p-0">
              <li v-for="issue in blockingIssues" :key="issue" class="flex items-start gap-1.5 text-[11px] leading-4 text-error">
                <Icon aria-hidden="true" class="mt-px flex-none text-sm" name="material-symbols:error-outline" />
                {{ TEMPLATE_ISSUE_LABELS[issue] }}
              </li>
            </ul>

            <div class="grid gap-4 sm:grid-cols-2">
              <ClaimBudgetMeter
                :max="MAX_CLAIM_BYTES"
                :used="nameBytes"
                label="Names, checked at save"
                note="The most a save can measure: the names with empty values."
              />
              <ClaimBudgetMeter
                :label="`Rendered for ${profile?.label.toLowerCase() ?? 'the sample'}`"
                :max="MAX_CLAIM_BYTES"
                :used="rendered.bytes"
                note="Measured again on every token, because only a user has values. Over the cap, the sign-in is refused rather than the token trimmed."
              />
            </div>
          </div>
        </LayerCard>

        <LayerCard
          :open="false"
          expandable
          description="What the server does with a template, whichever claims are in it. None of it is configurable, and each row says why."
          title="How a template behaves"
        >
          <div class="divide-y divide-line">
            <SettingRow :fixed="String(RESERVED_CLAIMS.length)" label="Reserved names">
              <template #description>
                <span class="font-mono text-ink/80">{{ RESERVED_CLAIMS.join(", ") }}</span> are
                assembled by the issuer and cannot be mapped. Overwriting
                <span class="font-mono text-ink/80">sub</span> would mint a token for somebody
                else; overwriting <span class="font-mono text-ink/80">aud</span> or
                <span class="font-mono text-ink/80">exp</span> would undo the checks every
                verifier makes. The list lives in the protocol, so this screen and the issuer
                cannot disagree about it.
              </template>
            </SettingRow>
            <SettingRow :fixed="`${USER_FIELDS.length} fields`" label="Claimable profile fields">
              <template #description>
                An allowlist, and it is exactly what the profile endpoint already returns. The
                direction is the point: a column added to users tomorrow is not publishable until
                somebody adds it to the list, where a denylist would have made a password hash
                claimable the day it was forgotten.
              </template>
            </SettingRow>
            <SettingRow
              description="A mapping onto a field the user has not filled in is left out of the token, never written as null. A verifier reading null has to decide what it means, and every one of them decides differently."
              fixed="Always"
              label="Absent, not null"
            />
            <SettingRow
              description="A required claim that resolves to nothing fails the issue: the sign-in is refused with claim_template_unsatisfied, and the claim's name reaches your logs and never the response. A claim your authorisation code branches on is one where absent and false read the same, so a token without it would let a sign-in through a check that never ran."
              fixed="Refuses"
              label="A required claim with nothing to carry"
            />
            <SettingRow
              :description="`${MAX_CLAIM_BYTES.toLocaleString('en')} bytes for the custom claims, checked twice: the names at save, and the rendered values at every issue, because a save is the only step that sees no value and a template of three short names can still render a profile blob. Tokens travel in a header proxies cap, and a token rejected for size fails somewhere with no sign of what did it.`"
              fixed="Twice"
              label="The budget"
            />
            <SettingRow
              :description="`Enough for a role, a tenant, a plan and a handful of flags. Past that is a lookup, not a token.`"
              :fixed="`${MAX_CLAIMS} claims`"
              label="How many"
            />
            <SettingRow
              description="Read by top-level key only. A dotted path would need an escape rule for a key that contains a dot, and a customer who wants a nested value can flatten it where they write it, once, rather than us guessing on every token."
              fixed="Top-level keys"
              label="Nested metadata"
            />
            <SettingRow
              description="The template is written whole with a secret key, never patched and never from a browser. A template decides what every token for the project says, so a publishable key sitting in a bundle must not be able to change it."
              fixed="Secret key"
              label="Who may save one"
            />
            <SettingRow
              description="The user row is already loaded when a token is minted and the template is one primary-key read in the same transaction. That is why this is configuration rather than a hook: a synchronous customize-claims call would put your own HTTP round trip inside every sign-in and every refresh."
              fixed="One read"
              label="What it costs at issue"
            />
          </div>
        </LayerCard>
      </div>

      <aside class="flex flex-col gap-4 xl:sticky xl:top-20">
        <LayerCard
          :padded="false"
          description="The payload, as the issuer would write it for the user chosen here. Dimmed lines are ours; marked lines are the template's."
          title="What a token carries"
        >
          <div class="flex flex-col gap-2 border-b border-line px-4 py-3">
            <SegmentedControl v-model="profileId" :options="PROFILE_OPTIONS" label="Sample user" stretch />
            <p class="m-0 text-[11px] leading-4 text-ink/50">{{ profile?.note }}</p>
          </div>

          <ClaimTokenPreview :assembled="assembled" :rendered="rendered" />

          <div class="flex flex-col gap-2 border-t border-line px-4 py-3 text-[11px] leading-4 text-ink/55">
            <p v-if="rendered.absent.length > 0" class="m-0 flex items-start gap-1.5">
              <Icon aria-hidden="true" class="mt-px flex-none text-sm" name="material-symbols:visibility-off-outline" />
              <span>
                Left out for this user, nothing to carry:
                <span class="font-mono text-ink/80">{{ rendered.absent.map((claim) => claim.name.trim() || "(unnamed)").join(", ") }}</span>
              </span>
            </p>
            <p v-if="rendered.overBudget" class="m-0 flex items-start gap-1.5 text-error">
              <Icon aria-hidden="true" class="mt-px flex-none text-sm" name="material-symbols:error-outline" />
              <span>
                The rendered claims outgrow the budget for this user, so the sign-in would be
                refused rather than the token trimmed.
              </span>
            </p>
            <p class="m-0 flex items-center justify-between gap-3">
              <span>Custom claims</span>
              <span :class="rendered.overBudget ? 'text-error' : 'text-ink'" class="font-mono tabular-nums">
                {{ rendered.present.length }} · {{ rendered.bytes.toLocaleString("en") }} bytes
              </span>
            </p>
          </div>
        </LayerCard>

        <LayerCard :padded="false" title="Guides">
          <ul class="m-0 list-none divide-y divide-line p-0">
            <li v-for="guide in GUIDES" :key="guide.href">
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
      </aside>
    </div>

    <ClaimAddDialog
      v-if="profile"
      v-model="addDialog"
      :existing="draft.claims"
      :sample="profile.user"
      @add="addClaim"
    />
    <ClaimAcknowledgeDialog
      v-model="acknowledgeDialog"
      :claims="privateClaims"
      @confirm="acknowledgeAndSave"
    />
    <UnsavedChangesDialog v-model="leaveDialog" @discard="discardAndLeave" />
  </div>
</template>

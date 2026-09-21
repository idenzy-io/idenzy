<script setup lang="ts">
/**
 * Claim templates: what this project's access tokens carry beyond the claims we assemble
 * (PROJECT.md 4.2, apps/api/src/claims), arranged the way `notes/tokens-claims.md`
 * asks. An editor pane and the token it produces, side by side from the desktop
 * breakpoint and behind two tabs below it, because a template is abstract until it meets
 * a user and the place to be surprised by what a token says is here.
 *
 * This is the one screen in the panel that does not save itself, and every part of it is
 * arranged to say so. A persistent toolbar carries the count of unpublished changes,
 * Discard and Publish template; the dialog that adds a claim says **Add to draft**; the
 * preview marks every line publishing would add, move or take away against what the
 * saved template renders for the same user. A first button that looks like publication
 * is the misreading this shape exists to prevent.
 *
 * Publishing whole is the server's shape and not a preference: the byte budget is on the
 * total, so a change to one claim is only checkable against every other, and `PUT` is the
 * only verb the management API offers. The draft is held per project, so switching
 * projects and back does not lose an edit and a draft can never be published into the
 * wrong project; leaving the route asks first, and so does closing the tab.
 *
 * Two findings shape the rest. A required claim can refuse a sign-in, so it is a visible
 * control on its own row and the template is judged against three sample users rather
 * than one synthetic complete profile: the accounts that hold nothing are ordinary, and
 * they are who a required claim locks out. And publishing private metadata is asked once,
 * at publish, naming each key and the value a token would actually carry.
 *
 * Every rule the publish applies is applied here first, from the same lists the server
 * reads (`@idenzy/protocol/schemas/claims`), so the button is blocked for exactly the
 * template the server would refuse and the row that caused it says why.
 */
import type { ClaimRowOutcome } from "~/components/ClaimRow.vue";
import {
  assembledClaims,
  CHANGE_ICONS,
  CLAIM_ISSUE_LABELS,
  type ClaimMapping,
  type ClaimTemplate,
  copyTemplate,
  isSameTemplate,
  MAX_CLAIM_BYTES,
  MAX_CLAIMS,
  namesBytes,
  profileOutcomes,
  RESERVED_CLAIMS,
  type RenderedTemplate,
  readsPrivateMetadata,
  refusedProfiles,
  SAMPLE_PROFILES,
  TEMPLATE_ISSUE_LABELS,
  templateChanges,
  tokenLines,
  USER_FIELDS,
  validateMapping,
  validateTemplate,
} from "~/utils/claims";
import { formatDateTime, relativeTimeWords } from "~/utils/time";

/* Vuetify's `lg` is 1280px and so is Tailwind's `xl`. The panes and the tabs are one
   decision, so the class and the composable have to name the same pixel. */
const { lgAndUp } = useDisplay();

const projects = useProjectStore();
const store = useClaimsStore();
const router = useRouter();

const saved = computed(() => store.templateFor(projects.current.id));

/*
 * The draft, one per project, seeded from what is saved the first time a project is
 * looked at after the template has loaded. Mappings are edited in place rather than
 * replaced, so a row keeps its identity while the draft is worked on.
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

/**
 * The draft to write into, seeded if the project has not been looked at yet. Read back
 * out of the ref rather than returned from the seed, or the mutation lands on a raw
 * object the reactivity never sees.
 */
function editable(): ClaimTemplate {
  const projectId = projects.current.id;
  if (drafts.value[projectId] === undefined) {
    drafts.value = { ...drafts.value, [projectId]: copyTemplate(saved.value) };
  }
  return drafts.value[projectId] as ClaimTemplate;
}

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

/*
 * Adding and editing go through one dialog: the fields and the rules are the same, and
 * neither writes anything past the draft.
 */
const formDialog = ref(false);
const editingIndex = ref<number | null>(null);
const editingClaim = computed<ClaimMapping | null>(() =>
  editingIndex.value === null ? null : (draft.value.claims[editingIndex.value] ?? null),
);
const full = computed(() => draft.value.claims.length >= MAX_CLAIMS);

function openAdd() {
  if (full.value) return;
  editingIndex.value = null;
  formDialog.value = true;
}

function openEdit(index: number) {
  editingIndex.value = index;
  formDialog.value = true;
}

function submitClaim(mapping: ClaimMapping) {
  const template = editable();
  const at = editingIndex.value;
  if (at === null) {
    if (full.value) return;
    template.claims.push({ ...mapping });
    return;
  }
  const claim = template.claims[at];
  if (claim !== undefined) Object.assign(claim, mapping);
}

function updateClaim(index: number, change: Partial<ClaimMapping>) {
  const claim = editable().claims[index];
  if (claim === undefined) return;
  Object.assign(claim, change);
}

function removeClaim(index: number) {
  editable().claims.splice(index, 1);
}

/*
 * Validity, from the same rules the server applies. The acknowledgement is the one issue
 * that does not block the button: it is asked for at publish instead.
 */
const mappingIssues = computed(() =>
  draft.value.claims.map((_, index) => validateMapping(draft.value.claims, index)),
);
const templateIssues = computed(() =>
  validateTemplate(draft.value).filter((issue) => issue !== "private_unacknowledged"),
);

/** Every real reason publishing is refused, each naming the claim that caused it. */
const problems = computed(() => {
  const rows = draft.value.claims.flatMap((claim, index) =>
    (mappingIssues.value[index] ?? []).map((issue) => ({
      id: `${rowId(claim)}-${issue}`,
      name: claim.name.trim() || "unnamed",
      text: CLAIM_ISSUE_LABELS[issue],
    })),
  );
  const whole = templateIssues.value.map((issue) => ({
    id: issue,
    name: "",
    text: TEMPLATE_ISSUE_LABELS[issue],
  }));
  return [...rows, ...whole];
});

const dirty = computed(() => !isSameTemplate(draft.value, saved.value));
const changes = computed(() => templateChanges(saved.value, draft.value));
/* A dirty draft always has something to say; the floor keeps the count honest if it does not. */
const changeCount = computed(() => Math.max(changes.value.length, dirty.value ? 1 : 0));

const privateClaims = computed(() =>
  draft.value.claims.filter((claim) => claim.source === "metadata_private"),
);
const readsPrivate = computed(() => readsPrivateMetadata(draft.value.claims));
const needsAcknowledgement = computed(
  () => readsPrivate.value && !draft.value.acknowledgePrivateMetadata,
);

const saving = ref(false);
const canPublish = computed(
  () => dirty.value && problems.value.length === 0 && !saving.value && !store.loading,
);

/** Why the button is refusing, beside the button, rather than a disabled state to solve. */
const blockedReason = computed(() => {
  if (saving.value || store.loading) return "";
  if (problems.value.length === 0) return dirty.value ? "" : "Nothing to publish";
  return problems.value.length === 1 ? "1 problem" : `${problems.value.length} problems`;
});

/*
 * The preview: the draft rendered for a sample user, marked against what the published
 * template renders for the same one.
 */
const profileId = ref<string>("complete");
const PROFILE_OPTIONS = SAMPLE_PROFILES.map((entry) => ({
  value: entry.id,
  label: entry.short,
  title: entry.label,
}));

const outcomes = computed(() =>
  profileOutcomes(draft.value.claims, saved.value.claims, dirty.value),
);
const outcome = computed(
  () => outcomes.value.find((entry) => entry.profile.id === profileId.value) ?? outcomes.value[0],
);
const profile = computed(() => outcome.value?.profile ?? SAMPLE_PROFILES[0]);
const rendered = computed<RenderedTemplate>(
  () =>
    outcome.value?.rendered ?? {
      present: [],
      absent: [],
      refusedBy: null,
      bytes: 2,
      overBudget: false,
    },
);
const refused = computed(() => refusedProfiles(outcomes.value));
const oversized = computed(() => outcomes.value.filter((entry) => entry.rendered.overBudget));

/* Held still for the visit, so the issued-at claim does not tick under the reader. */
const issuedAt = new Date();

const assembled = computed(() => {
  const user = profile.value?.user;
  return user === undefined ? {} : assembledClaims(user, projects.current.id, issuedAt);
});
const lines = computed(() =>
  tokenLines(assembled.value, rendered.value, outcome.value?.before ?? null),
);

function outcomeOf(index: number): ClaimRowOutcome {
  const claim = draft.value.claims[index];
  if (claim === undefined || (mappingIssues.value[index]?.length ?? 0) > 0) {
    return { kind: "invalid" };
  }
  if (rendered.value.refusedBy === claim) return { kind: "refused" };
  if (rendered.value.absent.includes(claim)) return { kind: "absent" };
  const hit = rendered.value.present.find((entry) => entry.name === claim.name.trim());
  return hit === undefined
    ? { kind: "invalid" }
    : { kind: "present", value: hit.value, bytes: hit.bytes };
}

const nameBytes = computed(() => namesBytes(draft.value.claims));

/*
 * Publishing. The acknowledgement dialog stands in front of a publish that reads private
 * metadata without one, and it stays open until the write has landed.
 */
const acknowledgeDialog = ref(false);

async function publish() {
  if (!canPublish.value) return;
  if (needsAcknowledgement.value) {
    acknowledgeDialog.value = true;
    return;
  }
  await commit();
}

async function acknowledgeAndPublish() {
  editable().acknowledgePrivateMetadata = true;
  if (await commit()) acknowledgeDialog.value = false;
}

/** The write, against the project the draft belongs to and never the one showing later. */
async function commit(): Promise<boolean> {
  const projectId = projects.current.id;
  const template = copyTemplate(draft.value);
  saving.value = true;
  try {
    const stored = await store.save(projectId, template);
    drafts.value = { ...drafts.value, [projectId]: copyTemplate(stored) };
    return true;
  } finally {
    saving.value = false;
  }
}

function discard() {
  replaceDraft(copyTemplate(saved.value));
}

/* Cmd+S and Ctrl+S publish, because an editor with a save button is expected to. */
useEventListener(window, "keydown", (event: KeyboardEvent) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void publish();
  }
});

/*
 * Leaving with a draft asks first, on both the routes the panel owns and the tab the
 * browser does. The browser's own prompt is all a reload or a close can have.
 */
useEventListener(window, "beforeunload", (event: BeforeUnloadEvent) => {
  if (dirty.value) event.preventDefault();
});

const leaveDialog = ref(false);
const leavingTo = ref<string | null>(null);

onBeforeRouteLeave((to) => {
  if (!dirty.value || leavingTo.value !== null) return true;
  leavingTo.value = to.fullPath;
  leaveDialog.value = true;
  return false;
});

/** Publishing from the leave dialog is only offered where it would go straight through. */
const leaveCanPublish = computed(() => canPublish.value && !needsAcknowledgement.value);
const leaveBlockedReason = computed(() => {
  if (needsAcknowledgement.value) {
    return "This draft publishes private metadata, which is acknowledged on the page rather than here.";
  }
  if (problems.value.length > 0) {
    return `The draft has ${problems.value.length === 1 ? "a problem" : `${problems.value.length} problems`} to settle before it can be published.`;
  }
  return "";
});

function leaveNow() {
  const target = leavingTo.value;
  if (target !== null) void router.push(target);
}

function discardAndLeave() {
  discard();
  leaveNow();
}

async function publishAndLeave() {
  if (!(await commit())) return;
  leaveDialog.value = false;
  leaveNow();
}

watch(leaveDialog, (open) => {
  if (!open && leavingTo.value !== null && dirty.value) leavingTo.value = null;
});

/* Which pane a phone is showing. A viewport arrangement rather than a place, so it is
   not in the URL: there is nothing here to link somebody to. */
const pane = ref<string>("editor");
const PANE_OPTIONS = [
  { value: "editor", label: "Editor", icon: "material-symbols:edit-outline" },
  { value: "preview", label: "Preview", icon: "material-symbols:visibility-outline" },
];

function showProfile(id: string) {
  profileId.value = id;
  if (!lgAndUp.value) pane.value = "preview";
}

/* Where the toolbar's refusal points, because a count without a way to read it is a puzzle. */
const checks = useTemplateRef<HTMLElement>("checks");

function goToProblems() {
  checks.value?.scrollIntoView({ behavior: "smooth", block: "center" });
}

/* The line in the toolbar that says where the template stands. */
const now = useNow({ interval: 30_000 });
const publishedAgo = computed(() => {
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
    href: "https://idenzy.io/docs/tokens/claims",
  },
  {
    icon: "material-symbols:code",
    title: "Reading claims on your server",
    detail: "The claims field in @idenzy/node, and branching on it safely.",
    href: "https://idenzy.io/docs/sdk/node/claims",
  },
  {
    icon: "material-symbols:data-object",
    title: "Public and private metadata",
    detail: "Which column to write to, and who can read each.",
    href: "https://idenzy.io/docs/users/metadata",
  },
  {
    icon: "material-symbols:database",
    title: "Token claims in Postgres policies",
    detail: "Using a claim inside row-level security without a lookup.",
    href: "https://idenzy.io/docs/tokens/rls",
  },
];
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="Claim templates">
      <template #description>
        What
        <span class="font-medium text-ink">{{ projects.current.name }}</span>'s access tokens
        carry beyond the claims we assemble. Your authorisation code reads them off the token
        with no lookup. Edited as a draft and published whole, because the budget is on the
        whole.
      </template>
    </PageHeader>

    <!--
      The editor toolbar. It bleeds to the content column's edges and sticks under the app
      bar, so the state of the draft and the way to publish it stay put however long the
      mapping list gets. Below the desktop breakpoint it carries the panes instead and
      Publish moves to the action row at the foot.
    -->
    <div
      class="sticky top-14 z-10 -mx-6 -mt-2 flex items-center justify-between gap-3 border-b border-line bg-canvas/85 px-6 py-2.5 backdrop-blur"
    >
      <p class="m-0 flex min-w-0 items-center gap-2 text-xs" role="status">
        <template v-if="saving">
          <Icon
            aria-hidden="true"
            class="flex-none animate-spin text-sm text-ink/55"
            name="material-symbols:progress-activity"
          />
          <span class="truncate text-ink/70">Publishing</span>
        </template>
        <template v-else-if="store.loading">
          <span aria-hidden="true" class="size-1.5 flex-none rounded-full bg-ink/25" />
          <span class="truncate text-ink/55">Reading the template</span>
        </template>
        <template v-else-if="dirty">
          <span aria-hidden="true" class="size-1.5 flex-none rounded-full bg-warning" />
          <span class="truncate font-medium text-ink">
            {{ changeCount === 1 ? "1 unpublished change" : `${changeCount} unpublished changes` }}
          </span>
        </template>
        <template v-else-if="saved.updatedAt">
          <span aria-hidden="true" class="size-1.5 flex-none rounded-full bg-success" />
          <v-tooltip :text="formatDateTime(saved.updatedAt)" location="bottom">
            <template #activator="{ props: tip }">
              <span v-bind="tip" class="truncate text-ink/70">Published {{ publishedAgo }}</span>
            </template>
          </v-tooltip>
        </template>
        <template v-else>
          <span aria-hidden="true" class="size-1.5 flex-none rounded-full bg-ink/25" />
          <span class="truncate text-ink/55">Never published</span>
        </template>
      </p>

      <!-- Below the breakpoint the two panes are tabs; above it they are both on screen. -->
      <div class="flex flex-none items-center gap-3">
        <SegmentedControl
          v-model="pane"
          :options="PANE_OPTIONS"
          class="xl:hidden"
          label="Pane"
        />

        <div class="hidden items-center gap-2 xl:flex">
          <button
            v-if="blockedReason && problems.length > 0"
            class="rounded-(--idenzy-radius-x-small) px-1 text-xs font-medium text-error underline decoration-error/40 underline-offset-2 transition-colors duration-150 hover:decoration-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            type="button"
            @click="goToProblems"
          >
            {{ blockedReason }}
          </button>
          <span v-else-if="blockedReason" class="px-1 text-xs text-ink/45">
            {{ blockedReason }}
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
          <v-btn
            :disabled="!canPublish"
            class="text-xs font-medium"
            color="neutral"
            size="small"
            variant="text"
            @click="publish"
          >
            <template #prepend>
              <Icon
                :class="saving ? 'animate-spin' : ''"
                :name="
                  saving ? 'material-symbols:progress-activity' : 'material-symbols:publish-outline'
                "
                aria-hidden="true"
                class="text-sm"
              />
            </template>
            Publish template
          </v-btn>
        </div>
      </div>
    </div>

    <!--
      What the preview would show, said where the preview is not: a refusal is the one
      failure on this screen that is invisible from the pane a reader is looking at, and
      below the breakpoint one of the two panes is always hidden.
    -->
    <div
      v-if="!store.loading && (refused.length > 0 || oversized.length > 0)"
      class="flex flex-col gap-2.5 rounded-(--idenzy-radius) border border-error/40 bg-error/5 px-4 py-3.5"
      role="status"
    >
      <p class="m-0 flex items-start gap-2 text-xs leading-5">
        <Icon
          aria-hidden="true"
          class="mt-0.5 flex-none text-base text-error"
          name="material-symbols:block"
        />
        <span class="text-ink">
          <template v-if="refused.length > 0">
            <span class="font-medium">
              {{
                refused.length === 1
                  ? "One sample user cannot sign in"
                  : `${refused.length} sample users cannot sign in`
              }}
            </span>
            with this draft: a required claim resolves to nothing for them, so the sign-in is
            refused rather than the claim left out. Real accounts look like these.
          </template>
          <template v-else>
            <span class="font-medium">The rendered claims outgrow the budget</span> for a sample
            user, so their sign-in would be refused rather than the token trimmed.
          </template>
        </span>
      </p>
      <div class="flex flex-wrap gap-2 pl-6">
        <button
          v-for="entry in refused.length > 0 ? refused : oversized"
          :key="entry.profile.id"
          class="inline-flex h-7 items-center gap-1.5 rounded-(--idenzy-radius-x-small) border border-error/40 bg-surface px-2.5 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-error/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          type="button"
          @click="showProfile(entry.profile.id)"
        >
          <Icon :name="entry.profile.icon" aria-hidden="true" class="text-sm text-ink/55" />
          {{ entry.profile.label }}
        </button>
      </div>
    </div>

    <div class="grid gap-6 xl:grid-cols-12 xl:items-start">
      <!-- The editor: seven of twelve columns, and the whole width when it is a tab. -->
      <div v-show="pane === 'editor' || lgAndUp" class="flex min-w-0 flex-col gap-6 xl:col-span-7">
        <LayerCard
          :padded="false"
          description="Each row is one claim: what the token calls it, where it reads from, and whether a token without it is worth issuing."
          title="Claim mappings"
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
              <v-btn
                class="text-xs font-medium"
                color="neutral"
                prepend-icon="material-symbols:add"
                size="small"
                variant="text"
                @click="openAdd"
              >
                Add claim
              </v-btn>
            </template>
          </EmptyState>

          <template v-else>
            <!-- Add sits immediately above the list, where the next row goes, and is a
                 different kind of thing from the Publish in the toolbar. -->
            <div
              class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-3 py-2"
            >
              <button
                :disabled="full"
                class="inline-flex h-8 items-center gap-1.5 rounded-(--idenzy-radius-x-small) px-2 text-xs font-medium text-ink/70 transition-colors duration-150 hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-40"
                type="button"
                @click="openAdd"
              >
                <Icon aria-hidden="true" class="text-base" name="material-symbols:add" />
                Add claim
              </button>
              <span class="px-1 text-[11px] text-ink/50">
                <template v-if="full">
                  A template holds at most {{ MAX_CLAIMS }} claims. Past that is a lookup.
                </template>
                <template v-else>Nothing here is published until the template is.</template>
              </span>
            </div>

            <ul class="m-0 list-none divide-y divide-line p-0">
              <ClaimRow
                v-for="(claim, index) in draft.claims"
                :key="rowId(claim)"
                :issues="mappingIssues[index] ?? []"
                :mapping="claim"
                :outcome="outcomeOf(index)"
                :row-id="rowId(claim)"
                :sample-label="(profile?.label ?? 'this user').toLowerCase()"
                @edit="openEdit(index)"
                @remove="removeClaim(index)"
                @update="updateClaim(index, $event)"
              />
            </ul>
          </template>

          <!-- The standing statement about private metadata. The deliberate one is asked
               once, at publish, and never per claim. -->
          <div
            v-if="!store.loading && readsPrivate"
            class="flex items-start gap-3 border-t border-line bg-ink/3 px-4 py-3.5"
          >
            <Icon
              aria-hidden="true"
              class="mt-px flex-none text-base text-warning"
              name="material-symbols:lock-open-outline"
            />
            <div class="flex flex-col gap-0.5 text-xs">
              <p class="m-0 font-medium text-ink">This template publishes private metadata</p>
              <p class="m-0 leading-5 text-ink/70">
                {{
                  privateClaims.length === 1
                    ? "One claim reads"
                    : `${privateClaims.length} claims read`
                }}
                <span class="font-mono text-ink/85">metadata_private</span>, which nothing outside
                the management API has seen until now. A token is signed, not encrypted.
                <template v-if="draft.acknowledgePrivateMetadata">
                  Acknowledged, and the time it was given is stored with the template.
                </template>
                <template v-else>
                  Publishing will ask you to acknowledge it, and name each key.
                </template>
              </p>
            </div>
          </div>
        </LayerCard>
      </div>

      <!-- The token: five of twelve columns, and its own tab below the breakpoint. -->
      <div
        v-show="pane === 'preview' || lgAndUp"
        class="flex min-w-0 flex-col gap-6 xl:sticky xl:top-26 xl:col-span-5"
      >
        <LayerCard
          :padded="false"
          description="The payload as the issuer would write it, for the user chosen here. Tinted lines are what publishing this draft would change."
          title="What a token carries"
        >
          <div class="flex flex-col gap-2 border-b border-line px-4 py-3">
            <SegmentedControl
              v-model="profileId"
              :options="PROFILE_OPTIONS"
              label="Sample user"
              stretch
            />
            <p class="m-0 text-[11px] leading-4 text-ink/50">{{ profile?.note }}</p>
          </div>

          <ClaimTokenPreview :lines="lines" :rendered="rendered" />

          <div class="flex flex-col gap-3 border-t border-line px-4 py-3">
            <!-- The legend for the gutter, shown only while there is a difference to read. -->
            <p
              v-if="dirty"
              class="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-4 text-ink/55"
            >
              <span class="text-ink/70">Against the published template:</span>
              <span class="flex items-center gap-1">
                <span aria-hidden="true" class="font-mono text-success">+</span> added
              </span>
              <span class="flex items-center gap-1">
                <span aria-hidden="true" class="font-mono text-warning">~</span> changed
              </span>
              <span class="flex items-center gap-1">
                <span aria-hidden="true" class="font-mono text-error/70">−</span> removed
              </span>
            </p>

            <p
              v-if="rendered.absent.length > 0"
              class="m-0 flex items-start gap-1.5 text-[11px] leading-4 text-ink/55"
            >
              <Icon
                aria-hidden="true"
                class="mt-px flex-none text-sm"
                name="material-symbols:visibility-off-outline"
              />
              <span>
                Left out for this user, nothing to carry:
                <span class="font-mono text-ink/80">{{
                  rendered.absent.map((claim) => claim.name.trim() || "(unnamed)").join(", ")
                }}</span>
              </span>
            </p>

            <ClaimBudgetMeter
              :label="`Rendered for ${(profile?.label ?? 'the sample').toLowerCase()}`"
              :max="MAX_CLAIM_BYTES"
              :used="rendered.bytes"
              note="Measured again on every token, because only a user has values. Over the cap the sign-in is refused rather than the token trimmed."
            />
          </div>
        </LayerCard>
      </div>
    </div>

    <!--
      Everything a publish is judged by, under both panes and on both tabs: what it would
      change, what stops it, and what it does to each sample user.
    -->
    <div ref="checks">
      <LayerCard
        :padded="false"
        description="What publishing would change, what would stop it, and what every sample user's token becomes."
        title="Before you publish"
      >
        <template #badge>
          <StatusBadge
            v-if="!store.loading"
            :label="
              problems.length > 0
                ? problems.length === 1
                  ? '1 problem'
                  : `${problems.length} problems`
                : dirty
                  ? 'Ready to publish'
                  : 'Nothing to publish'
            "
            :tone="problems.length > 0 ? 'error' : dirty ? 'success' : 'neutral'"
          />
        </template>

        <div class="grid gap-x-8 gap-y-6 px-4 py-4 lg:grid-cols-2">
          <section class="flex min-w-0 flex-col gap-2.5">
            <h3 class="m-0 text-xs font-medium text-ink">What publishing changes</h3>
            <ul v-if="changes.length > 0" class="m-0 flex list-none flex-col gap-1.5 p-0">
              <li
                v-for="change in changes"
                :key="`${change.kind}-${change.name}`"
                class="flex items-start gap-2 text-[11px] leading-4"
              >
                <Icon
                  :class="
                    change.kind === 'added'
                      ? 'text-success'
                      : change.kind === 'removed'
                        ? 'text-error'
                        : 'text-warning'
                  "
                  :name="CHANGE_ICONS[change.kind]"
                  aria-hidden="true"
                  class="mt-px flex-none text-sm"
                />
                <span class="min-w-0 text-ink/70">
                  <span v-if="change.name" class="font-mono text-ink">{{ change.name }}</span>
                  {{ change.detail }}
                </span>
              </li>
            </ul>
            <p v-else class="m-0 text-[11px] leading-4 text-ink/55">
              The draft is the published template. Tokens already carry exactly this.
            </p>
          </section>

          <section class="flex min-w-0 flex-col gap-2.5">
            <h3 class="m-0 text-xs font-medium text-ink">What stops it</h3>
            <ul v-if="problems.length > 0" class="m-0 flex list-none flex-col gap-1.5 p-0">
              <li
                v-for="problem in problems"
                :key="problem.id"
                class="flex items-start gap-2 text-[11px] leading-4"
              >
                <Icon
                  aria-hidden="true"
                  class="mt-px flex-none text-sm text-error"
                  name="material-symbols:error-outline"
                />
                <span class="min-w-0 text-ink/70">
                  <span v-if="problem.name" class="font-mono text-ink">{{ problem.name }}</span>
                  {{ problem.text }}
                </span>
              </li>
            </ul>
            <p v-else class="m-0 text-[11px] leading-4 text-ink/55">
              Nothing. Every claim has a name the issuer accepts and a key it can read, and the
              names fit the budget.
              <template v-if="needsAcknowledgement">
                Publishing will ask you to acknowledge the private metadata first; that is a
                question, not a fault.
              </template>
            </p>
          </section>
        </div>

        <div class="flex flex-col gap-3 border-t border-line px-4 py-4">
          <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 class="m-0 text-xs font-medium text-ink">Every sample user</h3>
            <p class="m-0 text-[11px] leading-4 text-ink/50">
              A required claim is refused per user, so a template checked against one complete
              profile is a template nobody has checked.
            </p>
          </div>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ClaimProfileCard
              v-for="entry in outcomes"
              :key="entry.profile.id"
              :active="entry.profile.id === profileId"
              :outcome="entry"
              @select="showProfile(entry.profile.id)"
            />
          </div>
        </div>

        <div class="border-t border-line px-4 py-3.5">
          <ClaimBudgetMeter
            :max="MAX_CLAIM_BYTES"
            :used="nameBytes"
            label="Names, checked when you publish"
            note="The most a publish can measure: the names with empty values. The rest is only knowable against a user, which is what the preview measures."
          />
        </div>
      </LayerCard>
    </div>

    <LayerCard
      :open="false"
      description="What the server does with a template, whichever claims are in it. None of it is configurable, and each row says why."
      expandable
      title="Technical limits"
    >
      <div class="divide-y divide-line">
        <SettingRow :fixed="String(RESERVED_CLAIMS.length)" label="Reserved names">
          <template #description>
            <span class="font-mono text-ink/80">{{ RESERVED_CLAIMS.join(", ") }}</span> are
            assembled by the issuer and cannot be mapped. Overwriting
            <span class="font-mono text-ink/80">sub</span> would mint a token for somebody else;
            overwriting <span class="font-mono text-ink/80">aud</span> or
            <span class="font-mono text-ink/80">exp</span> would undo the checks every verifier
            makes. The list lives in the protocol, so this screen and the issuer cannot disagree
            about it.
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
          :description="`${MAX_CLAIM_BYTES.toLocaleString('en')} bytes for the custom claims, checked twice: the names when you publish, and the rendered values at every issue, because a publish is the only step that sees no value and a template of three short names can still render a profile blob. Tokens travel in a header proxies cap, and a token rejected for size fails somewhere with no sign of what did it.`"
          fixed="Twice"
          label="The budget"
        />
        <SettingRow
          description="Enough for a role, a tenant, a plan and a handful of flags. Past that is a lookup, not a token."
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
          label="Who may publish one"
        />
        <SettingRow
          description="The user row is already loaded when a token is minted and the template is one primary-key read in the same transaction. That is why this is configuration rather than a hook: a synchronous customize-claims call would put your own HTTP round trip inside every sign-in and every refresh."
          fixed="One read"
          label="What it costs at issue"
        />
      </div>

      <ul class="m-0 grid list-none gap-x-4 border-t border-line p-0 sm:grid-cols-2">
        <li v-for="guide in GUIDES" :key="guide.href" class="min-w-0">
          <a
            :href="guide.href"
            class="flex items-start gap-3 px-4 py-3 text-xs no-underline transition-colors duration-150 hover:bg-ink/3"
            rel="noopener"
            target="_blank"
          >
            <Icon
              :name="guide.icon"
              aria-hidden="true"
              class="mt-px flex-none text-xl text-ink/70"
            />
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="font-medium text-ink">{{ guide.title }}</span>
              <span class="line-clamp-1 text-[11px] text-ink/55">{{ guide.detail }}</span>
            </span>
          </a>
        </li>
      </ul>
    </LayerCard>

    <!--
      The action row below the breakpoint, where the toolbar has given its right-hand side
      to the panes. Sticky rather than fixed, so it reserves its own space and never sits
      over the last row of the list.
    -->
    <div
      class="sticky bottom-0 z-10 flex items-center justify-between gap-3 rounded-(--idenzy-radius) border border-line bg-surface/95 px-3 py-2.5 shadow-lg backdrop-blur xl:hidden"
    >
      <button
        v-if="blockedReason && problems.length > 0"
        class="min-w-0 truncate rounded-(--idenzy-radius-x-small) px-1 text-xs font-medium text-error underline decoration-error/40 underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        type="button"
        @click="goToProblems"
      >
        {{ blockedReason }}
      </button>
      <span v-else class="min-w-0 truncate px-1 text-xs text-ink/50">
        {{ blockedReason || (dirty ? "Ready to publish" : "Nothing to publish") }}
      </span>
      <span class="flex flex-none items-center gap-2">
        <v-btn
          v-if="dirty && !saving"
          class="text-xs font-medium"
          color="neutral"
          size="small"
          variant="text"
          @click="discard"
        >
          Discard
        </v-btn>
        <v-btn
          :disabled="!canPublish"
          class="text-xs font-medium"
          color="neutral"
          size="small"
          variant="text"
          @click="publish"
        >
          <template #prepend>
            <Icon
              :class="saving ? 'animate-spin' : ''"
              :name="
                saving ? 'material-symbols:progress-activity' : 'material-symbols:publish-outline'
              "
              aria-hidden="true"
              class="text-sm"
            />
          </template>
          Publish template
        </v-btn>
      </span>
    </div>

    <ClaimAddDialog
      v-model="formDialog"
      :existing="draft.claims"
      :mapping="editingClaim"
      @submit="submitClaim"
    />
    <ClaimAcknowledgeDialog
      v-if="profile"
      v-model="acknowledgeDialog"
      :busy="saving"
      :claims="privateClaims"
      :project-name="projects.current.name"
      :sample="profile.user"
      :sample-label="profile.label"
      @confirm="acknowledgeAndPublish"
    />
    <UnsavedChangesDialog
      v-model="leaveDialog"
      :blocked-reason="leaveBlockedReason"
      :busy="saving"
      :changes="changeCount"
      :publishable="leaveCanPublish"
      description="The draft is held for this project while the panel is open, and lost on a reload. Tokens keep carrying the published template until this one replaces it."
      @discard="discardAndLeave"
      @publish="publishAndLeave"
    />
  </div>
</template>

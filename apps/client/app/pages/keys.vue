<script setup lang="ts">
/**
 * API keys for the project (notes/keys.md): the right credential for an integration, and a
 * way to replace one without interrupting traffic.
 *
 * The tabs under the title narrow one list: All keys, which is the page's own address, then
 * the live keys of each kind, then the revoked ones. Everything below the tabs belongs to the
 * one on show, the keys and any rotation somebody started on one. In All keys a live secret
 * key wears its own colour, because that is the one list where the two kinds sit together. The
 * tab lives in the query, replaced rather than pushed, as on the one-time codes screen.
 *
 * The revoked keys are reached through their own tab and nowhere else. A Show revoked
 * checkbox sat beside the tabs and folded them into All keys and the kind tabs as well,
 * which gave the same key two places to be and the count beside a tab two meanings.
 *
 * A rotation is explicit. It starts from a key's menu, the replacement names the key it
 * replaces, and the card that follows shows what has been observed of both rather than
 * deciding for anybody: two live keys are not a rotation, and a key silent for a day may
 * belong to a weekly job (P1). Revoking asks about the key's consumers every time, and the
 * compromised path, revoke first and deploy after, is a separate menu item.
 *
 * Purpose is a proposed field and said to be one, once, above the list. The row has no column
 * for a name, and a label kept only in the panel would be decoration.
 */
import type { RecordColumn } from "~/components/RecordTable.vue";
import type { SegmentedOption } from "~/components/SegmentedControl.vue";
import {
  type ApiKeyKind,
  isLive,
  KEY_FORMAT,
  KEY_KIND_CARRIERS,
  KEY_KIND_LABELS,
  KEY_KIND_PREFIXES,
  KEY_TABS,
  type KeyTab,
  keysOnTab,
  keyTabOf,
  type ProjectApiKey,
  PURPOSE_FIELD,
  rotationRole,
  rotationsOf,
  SCOPES,
  tabCounts,
} from "~/utils/keys";

const projects = useProjectStore();
const store = useKeysStore();
const route = useRoute();
const router = useRouter();
const { copy } = useClipboard({ legacy: true });

const project = computed(() => projects.current.id);
const keys = computed(() => store.keysFor(project.value));

// Loaded when the screen opens and again whenever the project changes. `keysFor` is
// deliberately synchronous — the screen reads it in a computed, and a fetch inside one is
// a request per render — so something has to fill the cache, and this is it.
watch(project, (id) => void store.load(id), { immediate: true });
const rotations = computed(() => rotationsOf(keys.value));

/* Live keys only on every tab but Revoked, which `tabCounts` and `keysOnTab` already do
   without being asked: the Revoked tab is the one place a revoked key is listed. */
const counts = computed(() => tabCounts(keys.value));

/*
 * The tab, in the URL. All keys is the page's own address and carries no query.
 */
const tabKey = computed<KeyTab>(() => {
  const asked = route.query["type"];
  return keyTabOf(Array.isArray(asked) ? asked[0] : asked);
});

const tab = computed<string>({
  get: () => tabKey.value,
  set: (value) => {
    const rest = Object.fromEntries(Object.entries(route.query).filter(([key]) => key !== "type"));
    void router.replace({ query: value === "all" ? rest : { ...rest, type: value } });
  },
});

const tabOptions = computed<SegmentedOption[]>(() =>
  KEY_TABS.map((entry) => ({
    value: entry.id,
    label: `${entry.label} · ${counts.value[entry.id]}`,
  })),
);

const shown = computed(() => keysOnTab(keys.value, tabKey.value));

/** The one kind the tab shows, or null for the two tabs that mix them. */
const kindOnTab = computed<ApiKeyKind | null>(() =>
  tabKey.value === "all" || tabKey.value === "revoked" ? null : tabKey.value,
);

/* All keys shows every rotation, a kind tab its own, Revoked none: a rotation is two live keys. */
const tabRotations = computed(() => {
  if (tabKey.value === "revoked") return [];
  if (kindOnTab.value === null) return rotations.value;
  return rotations.value.filter((entry) => entry.kind === kindOnTab.value);
});

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/* Live keys lead the heading whatever the tab, and the revoked ones are added to it only while
   they are on screen, so the heading counts the rows under it. */
const listHeading = computed(() => {
  if (store.loading) return "Reading this project's keys";
  if (tabKey.value === "revoked") {
    const count = shown.value.length;
    return count === 0 ? "Nothing revoked" : plural(count, "revoked key", "revoked keys");
  }
  const live = shown.value.filter(isLive).length;
  const gone = shown.value.length - live;
  const noun = kindOnTab.value === null ? "key" : KEY_KIND_LABELS[kindOnTab.value].toLowerCase();
  const head = live === 0 ? `No live ${noun}` : plural(live, `live ${noun}`, `live ${noun}s`);
  return gone > 0 ? `${head}, ${gone} revoked` : head;
});

const listDescription = computed(() => {
  if (tabKey.value === "all") {
    return `Both kinds together, with secret keys set apart in their own colour. ${PURPOSE_FIELD}`;
  }
  if (kindOnTab.value === "publishable") {
    return `What your application sends from the browser on ${KEY_KIND_CARRIERS.publishable}. It names the project and authorises nothing. ${PURPOSE_FIELD}`;
  }
  if (kindOnTab.value === "secret") {
    return `What your backend sends on ${KEY_KIND_CARRIERS.secret}. It acts as the project on the management API. ${PURPOSE_FIELD}`;
  }
  return "Refused on every request since they were revoked. They stay listed so a log line naming one still has something to point at.";
});

const emptyWords = computed(() => {
  if (tabKey.value === "all") {
    return counts.value.revoked > 0
      ? "No live key on this project. Nothing can reach it until one is made and deployed; the revoked ones are on the Revoked tab."
      : "This project has no keys yet. Nothing can reach it until one is made and deployed.";
  }
  if (kindOnTab.value === "publishable") {
    return "Nothing in a browser can reach this project until a publishable key is made and deployed.";
  }
  if (kindOnTab.value === "secret") {
    return "Your backend cannot call the management API until a secret key is made and deployed.";
  }
  return "No key on this project has been revoked.";
});

const COLUMNS: readonly RecordColumn[] = [
  { key: "key", label: "Key", width: "minmax(0, 1.6fr)" },
  { key: "prefix", label: "Prefix", width: "minmax(0, 1.2fr)" },
  { key: "createdBy", label: "Created by", width: "minmax(0, 1fr)" },
  { key: "observed", label: "Last observed use", width: "minmax(0, 1.2fr)" },
  { key: "actions", label: "", width: "28px", align: "end" },
];

const advancedOpen = ref(false);

function copyText(value: string) {
  void copy(value);
}

/** After a key is made on a kind tab, show that kind; All keys already shows it. */
function showKind(kind: ApiKeyKind) {
  if (tabKey.value !== "all") tab.value = kind;
}

/*
 * Making one, and the one time its value is shown.
 */
const createOpen = ref(false);
const creating = ref(false);
const createError = ref("");

/**
 * The plaintext, held for exactly as long as the dialog showing it is open, and dropped on
 * close rather than left for the garbage collector: it is the one thing on this screen that
 * could not be fetched again if it leaked somewhere it should not be.
 */
const revealed = ref<{
  key: ProjectApiKey;
  secret: string;
  replacing: ProjectApiKey | null;
} | null>(null);
const revealOpen = ref(false);

function openCreate() {
  createError.value = "";
  createOpen.value = true;
}

async function confirmCreate(kind: ApiKeyKind) {
  creating.value = true;
  createError.value = "";
  try {
    const made = await store.create(project.value, kind);
    createOpen.value = false;
    showKind(kind);
    revealed.value = { ...made, replacing: null };
    revealOpen.value = true;
  } catch {
    createError.value = "The key was not created. Nothing changed, so try again.";
  } finally {
    creating.value = false;
  }
}

/*
 * Rotating one.
 */
const rotateTarget = ref<ProjectApiKey | null>(null);
const rotateOpen = ref(false);
const rotating = ref(false);
const rotateError = ref("");

function askRotate(key: ProjectApiKey) {
  createOpen.value = false;
  detailOpen.value = false;
  rotateTarget.value = key;
  rotateError.value = "";
  rotateOpen.value = true;
}

async function confirmRotate() {
  const old = rotateTarget.value;
  if (old === null) return;
  rotating.value = true;
  rotateError.value = "";
  try {
    const made = await store.rotate(project.value, old);
    rotateOpen.value = false;
    showKind(old.kind);
    revealed.value = { ...made, replacing: old };
    revealOpen.value = true;
  } catch {
    rotateError.value = "The replacement was not created. The old key is untouched, so try again.";
  } finally {
    rotating.value = false;
  }
}

/*
 * Revoking one, for either reason.
 */
const revokeTarget = ref<ProjectApiKey | null>(null);
const revokeReason = ref<"retire" | "compromised">("retire");
const revokeOpen = ref(false);
const revoking = ref(false);
const revokeError = ref("");

function askRevoke(key: ProjectApiKey, reason: "retire" | "compromised") {
  detailOpen.value = false;
  rotateOpen.value = false;
  revokeTarget.value = key;
  revokeReason.value = reason;
  revokeError.value = "";
  revokeOpen.value = true;
}

async function confirmRevoke() {
  const key = revokeTarget.value;
  if (key === null) return;
  revoking.value = true;
  revokeError.value = "";
  try {
    await store.revoke(project.value, key.id);
    revokeOpen.value = false;
  } catch {
    revokeError.value = "The key was not revoked and still works. Try again.";
  } finally {
    revoking.value = false;
  }
}

const revokeRole = computed(() =>
  revokeTarget.value === null ? null : rotationRole(revokeTarget.value, rotations.value),
);
const revokeLastOfKind = computed(() => {
  const key = revokeTarget.value;
  return key !== null && store.liveOf(project.value)[key.kind].length <= 1;
});

/*
 * A key in full.
 */
const detailId = ref<string | null>(null);
const detailOpen = ref(false);
const detailKey = computed(() => keys.value.find((key) => key.id === detailId.value) ?? null);

function view(key: ProjectApiKey) {
  detailId.value = key.id;
  detailOpen.value = true;
}

/* A dialog belongs to the project it was opened from, and a revealed key certainly does. */
watch(project, () => {
  createOpen.value = false;
  rotateOpen.value = false;
  revokeOpen.value = false;
  detailOpen.value = false;
  revealOpen.value = false;
  revealed.value = null;
});
</script>

<template>
  <div class="flex w-full flex-col gap-6">
    <PageHeader title="API keys">
      <template v-if="rotations.length > 0" #badge>
        <StatusBadge
          :label="rotations.length === 1 ? 'Rotation in progress' : `${rotations.length} rotations in progress`"
          tone="warning"
        />
      </template>
      <template #description>
        The credentials that name
        <span class="font-medium text-ink">{{ projects.current.name }}</span> to us: a
        publishable key for code anybody can read, and a secret key for your servers.
      </template>
      <template #actions>
        <v-btn
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:add"
          size="small"
          variant="text"
          @click="openCreate"
        >
          Create Key
        </v-btn>
      </template>
    </PageHeader>

    <!-- The tabs, and nothing beside them: Revoked is one of them, so a checkbox that put
         revoked keys back into the other three narrowed the same list twice. -->
    <div class="-mt-1 max-w-full overflow-x-auto">
      <SegmentedControl v-model="tab" :options="tabOptions" label="Key type" />
    </div>

    <section class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-col gap-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">{{ listHeading }}</h2>
        <p class="m-0 text-xs leading-5 text-ink/55">{{ listDescription }}</p>
      </header>

      <RecordTable :columns="COLUMNS" framed label="API keys">
        <template v-if="store.loading">
          <li v-for="row in 2" :key="row" class="record-row">
            <span class="record-cell record-cell--primary flex items-center gap-3">
              <span class="size-7 flex-none animate-pulse rounded-(--idenzy-radius-x-small) bg-ink/8" />
              <span class="flex min-w-0 flex-1 flex-col gap-1.5">
                <span class="h-2.5 w-28 animate-pulse rounded-full bg-ink/8" />
                <span class="h-2 w-20 animate-pulse rounded-full bg-ink/6" />
              </span>
            </span>
            <span class="record-cell record-cell--half">
              <span class="block h-2.5 w-32 animate-pulse rounded-full bg-ink/8" />
            </span>
            <span class="record-cell record-cell--half">
              <span class="block h-2.5 w-20 animate-pulse rounded-full bg-ink/6" />
            </span>
            <span class="record-cell record-cell--half">
              <span class="block h-2.5 w-24 animate-pulse rounded-full bg-ink/6" />
            </span>
            <span class="record-cell record-cell--action" />
          </li>
        </template>

        <template v-else>
          <KeyRow
            v-for="key in shown"
            :key="key.id"
            :key-row="key"
            :mixed="tabKey === 'all'"
            :role="rotationRole(key, rotations)"
            @compromised="askRevoke(key, 'compromised')"
            @copy-id="copyText(key.id)"
            @copy-prefix="copyText(key.prefix)"
            @revoke="askRevoke(key, 'retire')"
            @rotate="askRotate(key)"
            @view="view(key)"
          />
        </template>

        <template v-if="!store.loading && shown.length === 0" #empty>
          <p class="m-0 px-4 py-10 text-center text-xs leading-5 text-ink/55">{{ emptyWords }}</p>
        </template>
      </RecordTable>
    </section>

    <!-- Only a rotation somebody started. Two live keys of one kind draw nothing here. -->
    <section v-if="tabRotations.length > 0" class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-col gap-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">
          {{ tabRotations.length === 1 ? "Rotation in progress" : `${tabRotations.length} rotations in progress` }}
        </h2>
        <p class="m-0 text-xs leading-5 text-ink/55">
          Started from a key's menu. Both keys work until the old one is revoked, and nothing
          here revokes it for you: the evidence is what was observed, not who still holds it.
        </p>
      </header>
      <KeyRotationCard
        v-for="rotation in tabRotations"
        :key="rotation.replacement.id"
        :project-name="projects.current.name"
        :rotation="rotation"
        @review="askRevoke(rotation.old, 'retire')"
        @view="view"
      />
    </section>

    <LayerCard
      v-model:open="advancedOpen"
      description="How a key is kept, checked and resolved. Reference for when something surprises you."
      expandable
      title="Advanced key behaviour"
    >
      <div class="divide-y divide-line">
        <SettingRow
          :description="`Only a ${KEY_FORMAT.digest} digest of a key is stored, under a unique index, so there is nothing to decrypt and nothing a copy of that table would yield. That is why a key is shown once, and why losing one means a new key rather than a lookup.`"
          :fixed="KEY_FORMAT.digest"
          label="Shown once"
        />
        <SettingRow
          :description="`The ${KEY_KIND_CARRIERS.publishable} header takes a ${KEY_KIND_PREFIXES.publishable} and nothing else, refused on the prefix before any lookup runs. A secret key pasted into client config and a fabricated one cost the same work and get the same answer.`"
          fixed="Always"
          label="Refused on the prefix"
        />
        <SettingRow
          description="The prefix is what the caller sent and the kind is what we issued, and the two are checked apart. A secret key issued with a publishable prefix by mistake must not become a secret key that works from a browser."
          fixed="Both"
          label="Prefix and kind"
        />
        <SettingRow
          description="The publishable-key header first, then Authorization, then Host. The first one present wins: a header that is present and resolves to nothing fails, because falling through to Host would let a request that named one project run against another."
          fixed="In order"
          label="How a request finds its project"
        />
        <SettingRow :description="SCOPES.note" :fixed="SCOPES.label" label="What a secret key may do" />
        <SettingRow
          description="There is no test mode, because the project is the environment: tenancy is keyed on the project at the database. A second project is how a staging environment is kept apart."
          fixed="By design"
          label="No test mode"
        />
        <SettingRow
          description="No expiry and no forced rotation. A key that stopped working on a date nobody wrote down is an outage at three in the morning; rotation is something somebody starts, above."
          fixed="Never"
          label="No expiry"
        />
        <SettingRow
          description="A secret key acting through the management API is recorded in the audit trail by its own id, which is why a revoked row stays: it is what an old entry is matched back to."
          fixed="Key ID"
          label="What the audit trail names"
        />
      </div>
    </LayerCard>

    <p class="m-0 text-xs text-ink/45">
      Every key made and revoked is recorded in the
      <NuxtLink
        class="font-medium text-ink/70 underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
        to="/audit"
      >
        audit log</NuxtLink
      >, against the name of whoever did it.
    </p>

    <!-- Mounted only while open, like every dialog here that writes and then closes: see
         the note in CLAUDE.md about a dialog left mounted across a write. -->
    <KeyCreateDialog
      v-if="createOpen"
      v-model="createOpen"
      :busy="creating"
      :error="createError"
      :live="store.liveOf(project)"
      :project-name="projects.current.name"
      :suggested="kindOnTab ?? 'publishable'"
      @confirm="confirmCreate"
      @rotate="askRotate"
    />

    <KeyRevealDialog
      v-if="revealOpen && revealed"
      v-model="revealOpen"
      :key-row="revealed.key"
      :replacing="revealed.replacing"
      :secret="revealed.secret"
      @done="revealed = null"
    />

    <KeyRotateDialog
      v-if="rotateOpen && rotateTarget"
      v-model="rotateOpen"
      :busy="rotating"
      :error="rotateError"
      :key-row="rotateTarget"
      :project-name="projects.current.name"
      @compromised="askRevoke(rotateTarget, 'compromised')"
      @confirm="confirmRotate"
    />

    <KeyRevokeDialog
      v-if="revokeOpen && revokeTarget"
      v-model="revokeOpen"
      :busy="revoking"
      :error="revokeError"
      :key-row="revokeTarget"
      :last-of-kind="revokeLastOfKind"
      :project-name="projects.current.name"
      :reason="revokeReason"
      :role="revokeRole"
      @confirm="confirmRevoke"
    />

    <KeyDetailDialog
      v-if="detailOpen && detailKey"
      v-model="detailOpen"
      :key-row="detailKey"
      :role="rotationRole(detailKey, rotations)"
      @revoke="askRevoke(detailKey, 'retire')"
      @rotate="askRotate(detailKey)"
    />
  </div>
</template>

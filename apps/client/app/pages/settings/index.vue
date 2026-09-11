<script setup lang="ts">
/**
 * The project's own row, and the short list of it a customer may change (PROJECT.md 4.13,
 * notes/settings.md).
 *
 * Most of this screen is not settings, and that is the shape of the table rather than a gap
 * in the page. A project is the unit of tenancy, of key custody and of residency, and three
 * of the things somebody arrives expecting to edit are decisions taken once at creation:
 * the cell is immutable because moving a project is an audited migration and never an
 * `UPDATE`, the tier is the technical half of a signed agreement, and the keys live in KMS
 * where nothing in a dashboard could reach them. So the page states them, with the reason
 * beside each, rather than offering controls the platform would refuse.
 *
 * Two things are genuinely editable and they are as different as they look. A name is a
 * label for this dashboard. Retention drives the purge worker, and PROJECT.md 4.13.6 is
 * blunt about why it matters: retention that is not enforced by a job is not retention.
 *
 * The two save models on the page are deliberate. The name is a dialog because it is one
 * value with a consequence worth previewing. Retention is a draft with its own Save at the
 * section's foot, because five ages chosen one menu at a time would be five writes and the
 * operator is making one decision (notes/settings.md, and the blueprint's rule that a
 * section's changes live inside that section).
 *
 * What is not here: the organisation's team and its wallet. They belong to the organisation
 * above this project rather than to it, so they are a row that says where they live and a
 * link, which is the scope finding this note opens with.
 */

import { isLive } from "~/utils/keys";
import { ORG_KIND_LABELS, ORG_PROJECTS_NOTE, orgKindOf } from "~/utils/organisation";
import {
  cellByCode,
  DELETE_EFFECTS,
  NAME_NOTE,
  PROJECT_ID_NOTE,
  RETENTION_ACTION_LABELS,
  RETENTION_CHOICES,
  RETENTION_INFO,
  RETENTION_SUBJECTS,
  type RetentionSubject,
  retentionLabel,
  TIER_AUDIT_YEARS,
  TIER_CHANGE_NOTE,
  TIER_LABELS,
  TIER_NOTES,
} from "~/utils/project-settings";
import { countSessionsByStatus } from "~/utils/sessions";
import { formatDate, formatDateTime } from "~/utils/time";

const projects = useProjectStore();
const store = useProjectSettingsStore();
const members = useMembersStore();
const users = useUsersStore();
const sessions = useSessionsStore();
const keys = useKeysStore();
const audit = useAuditStore();

const now = useNow({ interval: 60_000 });

const org = computed(() => projects.currentOrg);
const kind = computed(() => orgKindOf(members.forOrg(org.value.id).length));
const siblings = computed(() => projects.projectsOf(org.value.id));

const facts = computed(() => store.factsFor(projects.current.id, projects.current.name));
const cell = computed(() => cellByCode(facts.value.cellCode));
const saved = computed(() => store.retentionFor(projects.current.id, facts.value.tier));

/** What is in the project, for the dialog that ends it. */
const counts = computed(() => {
  const held = sessions.forProject(projects.current.id);
  return {
    users: users.forProject(projects.current.id).filter((user) => user.deletedAt === null).length,
    sessions: countSessionsByStatus(held, now.value).active,
    keys: keys.keysFor(projects.current.id).filter(isLive).length,
    audit: audit.forProject(projects.current.id).length,
  };
});

/* Which cards start unfolded. The infrastructure reference is read once and never again. */
const expanded = reactive({ reference: false });

/*
 * Saving.
 */
const busy = ref<Set<string>>(new Set());

function isBusy(key: string): boolean {
  return busy.value.has(key);
}

async function whileBusy(key: string, work: () => Promise<void>) {
  busy.value = new Set([...busy.value, key]);
  try {
    await work();
  } finally {
    busy.value = new Set([...busy.value].filter((entry) => entry !== key));
  }
}

const nameOpen = ref(false);

function confirmName(name: string) {
  void whileBusy("name", async () => {
    await projects.rename(projects.current.id, name);
    store.stamp(projects.current.id);
  });
}

/*
 * Retention, which is a draft.
 *
 * Five ages are one decision about what the purge worker sweeps, so they are chosen and
 * then saved rather than written a menu at a time. The audit subject is not in the draft
 * at all: it follows the tier, and a stored override of it would be a number the worker
 * ignores.
 */
const draft = ref<Record<RetentionSubject, string>>({ ...saved.value });

const editable = RETENTION_SUBJECTS.filter((subject) => !RETENTION_INFO[subject].fixedByTier);

watch(saved, (next) => {
  draft.value = { ...next };
});

watch(
  () => projects.current.id,
  () => {
    draft.value = { ...saved.value };
    nameOpen.value = false;
    deleteOpen.value = false;
  },
);

const changed = computed(() =>
  editable.filter((subject) => draft.value[subject] !== saved.value[subject]),
);
const retentionDirty = computed(() => changed.value.length > 0);

function setDraft(subject: RetentionSubject, maxAge: string) {
  draft.value = { ...draft.value, [subject]: maxAge };
}

function cancelRetention() {
  draft.value = { ...saved.value };
}

function saveRetention() {
  const pending = changed.value;
  if (pending.length === 0) return;
  void whileBusy("retention", async () => {
    for (const subject of pending) {
      await store.setRetention(projects.current.id, subject, draft.value[subject]);
    }
  });
}

/*
 * Ending it.
 */
const deleteOpen = ref(false);

function confirmDelete() {
  void whileBusy("delete", async () => {
    await projects.remove(projects.current.id);
    await navigateTo("/");
  });
}

/* The column stores a lowercase token; a badge is display and reads as a word. */
const planLabel = computed(
  () => facts.value.plan.charAt(0).toUpperCase() + facts.value.plan.slice(1),
);

const saving = computed(() => busy.value.size > 0);
const lastSaved = computed(() => store.lastSavedAt(projects.current.id));

const GUIDES_URL = "https://idenzy.dev/docs/projects";
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="General">
      <template #description>
        What <span class="font-medium text-ink">{{ projects.current.name }}</span> is, rather
        than what it does. A project is the boundary for tenancy, keys and residency, so most
        of what is here was decided when it was made and says so.
      </template>
      <template #actions>
        <v-btn
          :href="GUIDES_URL"
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:menu-book-outline"
          rel="noopener"
          size="small"
          target="_blank"
          variant="outlined"
        >
          Project guide
        </v-btn>
      </template>
    </PageHeader>

    <LayerCard
      description="The label, the identifier, and who it belongs to. One of the three can be changed."
      title="Project"
    >
      <div class="divide-y divide-line">
        <SettingRow :description="NAME_NOTE" label="Name">
          <template #actions>
            <span class="text-xs text-ink/70">{{ projects.current.name }}</span>
            <v-btn
              :loading="isBusy('name')"
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:edit-outline"
              size="small"
              variant="text"
              @click="nameOpen = true"
            >
              Rename
            </v-btn>
          </template>
        </SettingRow>

        <SettingRow :description="PROJECT_ID_NOTE" fixed="Fixed" label="Project ID">
          <template #detail>
            <CopyField :value="facts.id" dense label="Copy the project ID" />
          </template>
        </SettingRow>

        <!-- Where the team and the money live, which is the one thing this page is most
             often wrong about: both belong to the organisation, so both reach every project
             under it rather than this one. -->
        <SettingRow
          :description="`${ORG_PROJECTS_NOTE} This one is ${siblings.length === 1 ? 'the only project' : `one of ${siblings.length} projects`} under it.`"
          :fixed="`${org.name} · ${ORG_KIND_LABELS[kind]}`"
          label="Organisation"
        >
          <template #actions>
            <v-btn
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:group-outline"
              size="small"
              to="/settings/members"
              variant="text"
            >
              Members
            </v-btn>
          </template>
        </SettingRow>

        <SettingRow
          description="What this project is metered and billed against. The plan and the wallet are the organisation's, so changing either changes it for every project under it."
          :fixed="planLabel"
          label="Plan"
        >
          <template #actions>
            <v-btn
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:receipt-long-outline"
              size="small"
              to="/billing"
              variant="text"
            >
              Billing
            </v-btn>
          </template>
        </SettingRow>

        <SettingRow
          :description="`Everything on this page except the name and the retention ages was settled at that moment: the cell, the keys and the tier. ${formatDateTime(facts.createdAt)}.`"
          :fixed="formatDate(facts.createdAt)"
          label="Created"
        />
      </div>
    </LayerCard>

    <LayerCard
      v-if="cell"
      description="Which independent stack holds this project's data, and the law it sits under. Chosen once, at creation."
      title="Where this project lives"
    >
      <template #badge>
        <StatusBadge :detail="cell.code" :label="cell.jurisdiction" tone="neutral" />
      </template>

      <div class="divide-y divide-line">
        <SettingRow
          description="A cell is its own database, cache, key ring and compute. Moving a project between them is an explicit, audited migration and never an update, which is what lets this be described as residency rather than as a preference."
          fixed="Immutable"
          :label="`Region · ${cell.label}`"
        />
        <SettingRow
          description="The host your SDKs call, unless you have put a custom auth domain in front of it. A project in another cell answers on a different one."
          label="API endpoint"
        >
          <template #detail>
            <CopyField :value="cell.endpoint" dense label="Copy the API endpoint" />
          </template>
        </SettingRow>
        <SettingRow
          description="A request that resolves to a project in another cell is refused rather than proxied, so data cannot transit a jurisdiction by accident."
          fixed="Refused"
          label="Cross-cell access"
        />
        <SettingRow
          description="Billing identifiers and a pointer to this cell, and nothing of your users. That is the property an EU-resident claim actually rests on: there is no personal data outside the cell to be resident anywhere else."
          fixed="No personal data"
          label="What the global control plane holds"
        />
      </div>
    </LayerCard>

    <LayerCard :description="TIER_NOTES[facts.tier]" title="Compliance tier">
      <template #badge>
        <StatusBadge
          :label="TIER_LABELS[facts.tier]"
          :tone="facts.tier === 'hipaa' ? 'success' : 'neutral'"
        />
      </template>

      <div class="divide-y divide-line">
        <SettingRow
          description="Audit partitions are dropped on this schedule, and the tier is the only thing that sets it. Raising it later does not bring back a partition already dropped."
          :fixed="`${TIER_AUDIT_YEARS[facts.tier]} ${TIER_AUDIT_YEARS[facts.tier] === 1 ? 'year' : 'years'}`"
          label="Audit retention"
        />
        <SettingRow
          description="Provider tokens, authenticator secrets and anything a HIPAA-tier project marks as protected health information go through a per-project key. On this tier that set is fixed; on the HIPAA tier it is mandatory for anything so marked."
          :fixed="facts.tier === 'hipaa' ? 'Mandatory on PHI' : 'On declared columns'"
          label="Field-level encryption"
        />
        <SettingRow
          description="Which of our own suppliers may touch this project's data. The HIPAA tier narrows it to what a business associate agreement covers."
          :fixed="facts.tier === 'hipaa' ? 'BAA scope' : 'Standard list'"
          label="Subprocessors"
        />
        <SettingRow :description="TIER_CHANGE_NOTE" fixed="With your agreement" label="Changing it" />
      </div>

      <p
        class="m-0 mt-5 flex items-start gap-2 rounded-(--idenzy-radius-small) bg-ink/4 ring-1 ring-ink/6 ring-inset px-3 py-2.5 text-[11px] leading-4 text-ink/65"
      >
        <Icon
          aria-hidden="true"
          class="mt-px flex-none text-sm text-ink/40"
          name="material-symbols:info-outline"
        />
        <span>
          The architecture is built for SOC 2, ISO 27001, GDPR and HIPAA. No certification is
          held today, and a tier here describes the controls a project runs under rather than
          a certificate anybody has issued.
        </span>
      </p>
    </LayerCard>

    <!-- Retention is the one part of this page with teeth, and the one draft on it. -->
    <LayerCard
      description="What the purge worker sweeps and when. Retention nothing enforces is not retention, so each of these is a job on a schedule rather than a promise."
      title="Retention"
    >
      <div class="divide-y divide-line">
        <SettingRow
          v-for="subject in RETENTION_SUBJECTS"
          :key="subject"
          :description="RETENTION_INFO[subject].note"
          :fixed="RETENTION_ACTION_LABELS[RETENTION_INFO[subject].action]"
          :label="RETENTION_INFO[subject].label"
        >
          <template #actions>
            <span
              v-if="RETENTION_INFO[subject].fixedByTier"
              class="flex items-center gap-2 text-xs text-ink/60"
            >
              <span class="font-mono">{{ retentionLabel(saved[subject]) }}</span>
              <v-tooltip
                location="top"
                max-width="280"
                text="Set by the compliance tier, because the age of an audit trail is what an auditor is promised rather than what an operator prefers."
              >
                <template #activator="{ props: tip }">
                  <span
                    v-bind="tip"
                    class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55"
                  >
                    From the tier
                  </span>
                </template>
              </v-tooltip>
            </span>

            <v-menu v-else :offset="4" location="bottom end">
              <template #activator="{ props: activator }">
                <v-btn
                  v-bind="activator"
                  class="text-xs font-medium"
                  :class="draft[subject] !== saved[subject] ? 'text-primary' : ''"
                  color="neutral"
                  size="small"
                  variant="text"
                >
                  <span class="font-mono">{{ retentionLabel(draft[subject]) }}</span>
                  <Icon
                    aria-hidden="true"
                    class="ml-1 text-base"
                    name="material-symbols:keyboard-arrow-down"
                  />
                </v-btn>
              </template>
              <v-list density="compact" min-width="160" nav>
                <v-list-item
                  v-for="choice in RETENTION_CHOICES[subject]"
                  :key="choice"
                  :active="draft[subject] === choice"
                  :title="retentionLabel(choice)"
                  @click="setDraft(subject, choice)"
                />
              </v-list>
            </v-menu>
          </template>
        </SettingRow>
      </div>

      <!-- Save at the section's bottom right with Cancel to its left, which is the
           blueprint's rule for a section that holds a draft. -->
      <div class="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        <p v-if="retentionDirty" class="m-0 mr-auto text-[11px] text-ink/55">
          {{ changed.length === 1 ? "One age" : `${changed.length} ages` }} not saved yet. The
          purge worker keeps using the saved values until you save.
        </p>
        <v-btn
          :disabled="!retentionDirty || isBusy('retention')"
          class="text-xs font-medium"
          color="neutral"
          size="small"
          variant="text"
          @click="cancelRetention"
        >
          Cancel changes
        </v-btn>
        <v-btn
          :disabled="!retentionDirty"
          :loading="isBusy('retention')"
          class="text-xs font-medium"
          color="primary"
          size="small"
          variant="flat"
          @click="saveRetention"
        >
          Save changes
        </v-btn>
      </div>
    </LayerCard>

    <!-- Everything a customer cannot act on, folded away: the note asks for the RLS and
         key-management internals to be secondary rather than to sit between two settings. -->
    <LayerCard
      v-model:open="expanded.reference"
      description="Where this project's keys are, who can use them, and why one project cannot read another. Nothing here is configurable and each row says why not."
      expandable
      title="Advanced infrastructure reference"
    >
      <div class="divide-y divide-line">
        <SettingRow
          description="A per-project signing key whose private half never leaves KMS. Tokens are signed by a call into it rather than by a secret this application holds, so a copy of our database yields nothing that can mint one."
          fixed="In KMS"
          label="Token signing key"
        />
        <SettingRow
          description="A per-project data encryption key, wrapped by this cell's key ring. It is what field-level encryption runs under, and it is why a key compromise has a blast radius of one tenant rather than one region."
          fixed="Wrapped"
          label="Data encryption key"
        />
        <SettingRow
          description="Key administrators are not key users, and every signing and unwrapping call is recorded in the cloud audit log. That separation is enforced by access management rather than by policy, which is the difference between a control and an intention."
          fixed="Separated"
          label="Who may use a key"
        />
        <SettingRow
          description="Every tenant table is filtered by the project id at the database, and this project's own row is filtered by its id too. Reading another project's row is not an oversight waiting to be fixed: the policy returns nothing, whatever the application asks for."
          fixed="At the database"
          label="Tenant isolation"
        />
      </div>
    </LayerCard>

    <SaveStatus :last-saved="lastSaved" :saving="saving" />

    <!-- Its own frame rather than a LayerCard, and last on the page: this is the one place
         where the weight should differ before anything is read, and the note asks for it
         separated from Rename rather than beside it. -->
    <section class="rounded-(--idenzy-radius-large) border border-error/25 bg-error/3 p-1">
      <header class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2">
        <div class="flex min-w-0 flex-col gap-0.5">
          <h2 class="m-0 flex items-center gap-2 text-sm font-medium text-ink">
            <Icon
              aria-hidden="true"
              class="text-base text-error"
              name="material-symbols:warning-outline"
            />
            Delete this project
          </h2>
          <p class="m-0 text-xs text-ink/55">
            Everything in it, and the key that makes the encrypted parts readable.
          </p>
        </div>
      </header>

      <div class="overflow-hidden rounded-(--idenzy-radius) border border-line bg-surface p-5">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <ul class="m-0 flex list-none flex-col gap-1.5 p-0 text-xs leading-5 text-ink/70">
            <li
              v-for="effect in DELETE_EFFECTS.slice(0, 3)"
              :key="effect.id"
              class="flex items-start gap-2"
            >
              <Icon
                :name="effect.icon"
                aria-hidden="true"
                class="mt-0.5 flex-none text-sm text-error/70"
              />
              {{ effect.label }}
            </li>
          </ul>
          <v-tooltip
            :disabled="projects.canDelete"
            location="top"
            max-width="280"
            text="It is the only project in this organisation. An organisation with none has nothing for its members to sign in to, so make another one first."
          >
            <template #activator="{ props: tip }">
              <span v-bind="tip">
                <v-btn
                  :disabled="!projects.canDelete"
                  class="text-xs font-medium"
                  color="error"
                  size="small"
                  variant="flat"
                  @click="deleteOpen = true"
                >
                  Delete project
                </v-btn>
              </span>
            </template>
          </v-tooltip>
        </div>
        <p class="m-0 mt-4 text-[11px] leading-4 text-ink/50">
          The dialog lists what goes and what is kept, with the counts, before anything
          happens. The organisation's billing record survives pseudonymously for six years,
          because statutory financial record keeping requires it and it names none of your
          users.
        </p>
      </div>
    </section>

    <ProjectNameDialog
      v-if="nameOpen"
      v-model="nameOpen"
      :busy="isBusy('name')"
      :current="projects.current.name"
      @confirm="confirmName"
    />

    <ProjectDeleteDialog
      v-if="deleteOpen"
      v-model="deleteOpen"
      :allowed="projects.canDelete"
      :busy="isBusy('delete')"
      :keys="counts.keys"
      :name="projects.current.name"
      :sessions="counts.sessions"
      :users="counts.users"
      @confirm="confirmDelete"
    />
  </div>
</template>

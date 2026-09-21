<script setup lang="ts">
/**
 * The project's own row, and the short list of it a customer may change (PROJECT.md 4.13,
 * notes/settings.md).
 *
 * Most of this screen is not settings, and that is the shape of the table rather than a gap
 * in the page. A project is the unit of tenancy and of key custody, and the things somebody
 * arrives expecting to edit are mostly decisions taken once at creation: the tier is the
 * technical half of a signed agreement, and key custody is meant to sit in KMS where nothing
 * in a dashboard could reach it.
 *
 * "Meant to" is load-bearing. The folded reference at the foot of this page used to assert ten
 * infrastructure facts and five were untrue of the code — keys in KMS, key administrators
 * separated. They now render from `ControlCapability` declarations
 * that say what runs here, because a security reference a customer reads is the worst place to
 * describe a design in the present tense (notes/settings.md P1).
 *
 * So the page is the project's detail page rather than a stack of settings cards: what it
 * is, in one band of facts, then the one thing on it with teeth. Each of those facts used
 * to be a row with a paragraph under it, which put four hundred pixels of reading in front
 * of the first control and made this screen indistinguishable from the two beside it. The
 * sentences are all still here, behind the glyph on each label, where they answer somebody
 * who asks and stay out of the way of somebody who does not (notes/shared-experience.md:
 * one main container boundary per task, and state before controls before rationale).
 *
 * Two things are genuinely editable and they are as different as they look. A name is a
 * label for this dashboard. Retention drives the purge worker, and PROJECT.md 4.13.6 is
 * blunt about why it matters: retention that is not enforced by a job is not retention.
 *
 * The two save models are deliberate. The name is a dialog because it is one value with a
 * consequence worth previewing. Retention is a draft with its own Save at the section's
 * foot, because five ages chosen one menu at a time would be five writes and the operator
 * is making one decision.
 *
 * What is not here: the organisation's team and its wallet. They belong to the organisation
 * above this project rather than to it, so each is a fact that names where it lives and
 * links there, which is the scope finding this note opens with.
 */

import type { Fact } from "~/components/FactGrid.vue";
import type { RecordColumn } from "~/components/RecordTable.vue";
import { isLive } from "~/utils/keys";
import { ORG_KIND_LABELS, ORG_PROJECTS_NOTE, orgKindOf } from "~/utils/organisation";
import {
  AUDIT_RETENTION_ENFORCEMENT,
  type ControlCapability,
  DELETE_EFFECTS,
  KEY_ADMIN_SEPARATION,
  KMS_SIGNING,
  NAME_NOTE,
  PROJECT_ID_NOTE,
  RETENTION_ACTION_LABELS,
  RETENTION_CHOICES,
  RETENTION_INFO,
  RETENTION_SUBJECTS,
  type RetentionSubject,
  retentionLabel,
  TENANT_ISOLATION,
  TIER_AUDIT_YEARS,
  TIER_CHANGE_NOTE,
  TIER_LABELS,
  TIER_NOTES,
  WRAPPED_DEK,
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

/* The column stores a lowercase token; a badge is display and reads as a word. */
const planLabel = computed(
  () => facts.value.plan.charAt(0).toUpperCase() + facts.value.plan.slice(1),
);

const auditYears = computed(() => {
  const years = TIER_AUDIT_YEARS[facts.value.tier];
  return `${years} ${years === 1 ? "year" : "years"}`;
});

/**
 * What the project is, read across rather than down.
 *
 * Six answers to "which project am I in and where does it run", and the sentence that used
 * to be a paragraph under each one is now its `info`. Two of them are somewhere else's
 * business and say so by linking there rather than by explaining it.
 */
const identity = computed<Fact[]>(() => [
  {
    key: "id",
    label: "Project ID",
    value: facts.value.id,
    mono: true,
    copy: facts.value.id,
    info: PROJECT_ID_NOTE,
  },
  {
    key: "org",
    label: "Organisation",
    value: org.value.name,
    to: "/settings/members",
    note: `${ORG_KIND_LABELS[kind.value]} · ${siblings.value.length === 1 ? "this project only" : `${siblings.value.length} projects`}`,
    info: ORG_PROJECTS_NOTE,
  },
  {
    key: "plan",
    label: "Plan",
    value: planLabel.value,
    to: "/billing",
    note: `${TIER_LABELS[facts.value.tier]} tier`,
    info: "What this project is metered and billed against. The plan and the wallet are the organisation's, so changing either changes it for every project under it.",
  },
  {
    key: "created",
    label: "Created",
    value: formatDate(facts.value.createdAt),
    note: formatDateTime(facts.value.createdAt),
    info: "Everything about this project except its name and the retention ages was settled at that moment: the keys and the tier.",
  },
]);

/**
 * One declared control, rendered as what it actually does here.
 *
 * The dot is the whole point of routing these through a helper: a reader scanning the grid sees
 * which controls are in effect without opening ten glyphs, and a control that is designed but
 * not deployed cannot read as one that is.
 */
function controlFact(key: string, label: string, control: ControlCapability): Fact {
  return {
    key,
    label,
    value: control.value,
    info: control.reason,
    dot: control.running ? "bg-success" : "bg-warning",
  };
}

const controls = computed<ControlCapability[]>(() => [
  AUDIT_RETENTION_ENFORCEMENT,
  KMS_SIGNING,
  WRAPPED_DEK,
  KEY_ADMIN_SEPARATION,
  TENANT_ISOLATION,
]);

/**
 * The tier's consequences and the key custody behind them, folded away.
 *
 * Nothing here is configurable and each one is a single value, so ten of them are a grid rather
 * than three cards of prose. The heading carries what a shut section owes its reader — which now
 * includes how much of this is running, because most of it is not.
 */
const infrastructure = computed<Fact[]>(() => [
  {
    key: "audit",
    label: "Audit retention",
    value: auditYears.value,
    info: "How long audit entries are kept, and the tier is the only thing that sets it.",
    note: AUDIT_RETENTION_ENFORCEMENT.value,
    dot: AUDIT_RETENTION_ENFORCEMENT.running ? "bg-success" : "bg-warning",
  },
  {
    key: "fle",
    label: "Field-level encryption",
    value: facts.value.tier === "hipaa" ? "Mandatory on PHI" : "On declared columns",
    info: "Provider tokens, authenticator secrets and anything a HIPAA-tier project marks as protected health information go through a per-project key. On this tier that set is fixed; on the HIPAA tier it is mandatory for anything so marked.",
  },
  {
    key: "subprocessors",
    label: "Subprocessors",
    value: facts.value.tier === "hipaa" ? "BAA scope" : "Standard list",
    info: "Which of our own suppliers may touch this project's data. The HIPAA tier narrows it to what a business associate agreement covers.",
  },
  {
    key: "tier-change",
    label: "Changing the tier",
    value: "With your agreement",
    info: TIER_CHANGE_NOTE,
  },
  controlFact("signing-key", "Token signing key", KMS_SIGNING),
  controlFact("dek", "Data encryption key", WRAPPED_DEK),
  controlFact("key-admins", "Who may use a key", KEY_ADMIN_SEPARATION),
  controlFact("isolation", "Tenant isolation", TENANT_ISOLATION),
]);

/* Read once and never again, so it opens shut. */
const referenceOpen = ref(false);

/**
 * What the shut heading says, and it has to be true shut.
 *
 * It used to end "keys in KMS", which was the least true thing on the screen. The count is the
 * honest replacement: a reader who never opens the section still learns that most of what is
 * inside is designed rather than deployed, which is the one thing they would want to know.
 */
const referenceSummary = computed(() => {
  const inEffect = controls.value.filter((control) => control.running).length;
  return [
    `${TIER_LABELS[facts.value.tier]} tier`,
    `audit kept ${auditYears.value}`,
    `${inEffect} of ${controls.value.length} controls in effect`,
  ].join(" · ");
});

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
    // One call per age, and it stops at the first refusal. Carrying on would leave the
    // screen claiming four saves when the second was rejected, and the ages it did write
    // are written — so the draft keeps whatever is still unsaved rather than being reset.
    for (const subject of pending) {
      if (!(await store.setRetention(projects.current.id, subject, draft.value[subject]))) return;
    }
  });
}

const RETENTION_COLUMNS: readonly RecordColumn[] = [
  { key: "subject", label: "Data", width: "minmax(0, 1.6fr)" },
  { key: "action", label: "What the sweep does", width: "minmax(0, 1fr)" },
  { key: "age", label: "Kept for", width: "150px", align: "end" },
];

/*
 * Ending it.
 */
const deleteOpen = ref(false);

function confirmDelete() {
  void whileBusy("delete", async () => {
    // Only on a deletion that happened. The service keeps the last project in an
    // organisation, and navigating away from one that is still there would read as a
    // delete that worked and a switcher that had not caught up.
    if (!(await projects.remove(projects.current.id))) return;
    deleteOpen.value = false;
    await navigateTo("/");
  });
}

const saving = computed(() => busy.value.size > 0);
const lastSaved = computed(() => store.lastSavedAt(projects.current.id));

const GUIDES_URL = "https://idenzy.io/docs/projects";
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- The project is the subject, so the project is the title, the way a person's name
         titles their own page. The breadcrumb and the rail both still say General. -->
    <PageHeader :title="projects.current.name">
      <template #badge>
        <StatusBadge :detail="TIER_LABELS[facts.tier]" :label="planLabel" tone="neutral" />
      </template>
      <template #description>
        The boundary for tenancy and keys. The label is the part you own.
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
        <v-tooltip :text="NAME_NOTE" location="bottom" max-width="300">
          <template #activator="{ props: tip }">
            <v-btn
              v-bind="tip"
              :loading="isBusy('name')"
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:edit-outline"
              size="small"
              variant="outlined"
              @click="nameOpen = true"
            >
              Rename
            </v-btn>
          </template>
        </v-tooltip>
      </template>
    </PageHeader>

    <!-- Three across rather than six: the settings rail takes 228px off the content, and
         six tracks put a long value into an ellipsis. -->
    <FactGrid :columns="3" :facts="identity" label="Project facts" />

    <!-- A rename, a delete or a retention age the API refused. -->
    <InfoNote
      v-if="(projects.refusal ?? store.refusal) !== null"
      :text="projects.refusal ?? store.refusal ?? ''"
      icon="material-symbols:error-outline"
      tone="warning"
    />

    <!-- The one thing on this page with teeth, and so the one region on it with a frame
         and a save. `divided` off because the fact band above is already a boundary. -->
    <PageSection
      :divided="false"
      description="What the purge worker sweeps, and when. Retention nothing enforces is not retention, so each of these is a job on a schedule rather than a promise."
      title="Retention"
    >
      <div>
        <RecordTable :columns="RETENTION_COLUMNS" framed label="Retention ages">
          <li v-for="subject in RETENTION_SUBJECTS" :key="subject" class="record-row">
            <span class="record-cell record-cell--primary" data-label="Data">
              <span class="flex min-w-0 items-center gap-2">
                <Icon
                  :name="RETENTION_INFO[subject].icon"
                  aria-hidden="true"
                  class="flex-none text-sm text-ink/40"
                />
                <span class="truncate font-medium text-ink">
                  {{ RETENTION_INFO[subject].label }}
                </span>
                <button
                  :aria-label="`About ${RETENTION_INFO[subject].label}`"
                  class="flex size-4 flex-none items-center justify-center rounded-full text-ink/40 transition-colors duration-150 hover:text-ink/80 focus-visible:text-ink/80 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                  type="button"
                >
                  <Icon aria-hidden="true" class="text-sm" name="material-symbols:info-outline" />
                  <v-tooltip
                    :text="RETENTION_INFO[subject].note"
                    activator="parent"
                    location="top"
                    max-width="280"
                    open-delay="200"
                  />
                </button>
              </span>
            </span>

            <span class="record-cell record-cell--half text-ink/60" data-label="What the sweep does">
              {{ RETENTION_ACTION_LABELS[RETENTION_INFO[subject].action] }}
            </span>

            <span
              class="record-cell record-cell--end record-cell--action"
              data-label="Kept for"
            >
              <!-- The audit age is the tier's, so it is a value with a reason and never a
                   disabled menu: a control that cannot be used is a control that lies. -->
              <span
                v-if="RETENTION_INFO[subject].fixedByTier"
                class="flex items-center justify-end gap-2"
              >
                <span class="font-mono text-ink/70">{{ retentionLabel(saved[subject]) }}</span>
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
                    :class="draft[subject] !== saved[subject] ? 'text-primary' : ''"
                    class="text-xs font-medium"
                    color="neutral"
                    size="small"
                    variant="text"
                  >
                    <!-- An age nobody has chosen is still an age the sweeper runs at, and the
                         two are not the same fact. Only on a row with no unsaved change,
                         because a draft is a choice being made. -->
                    <span
                      v-if="store.isDefault(projects.current.id, subject) && draft[subject] === saved[subject]"
                      class="mr-1.5 rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/45"
                    >
                      Default
                    </span>
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
            </span>
          </li>
        </RecordTable>

        <!-- Save at the section's bottom right with Cancel to its left, which is the
             blueprint's rule for a section that holds a draft. -->
        <div class="mt-4 flex flex-wrap items-center justify-end gap-2">
          <p v-if="retentionDirty" class="m-0 mr-auto text-xs text-ink/55">
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
      </div>
    </PageSection>

    <!-- Everything a customer cannot act on, in one fold rather than between two things
         they can. The heading carries the values, so a shut section still answers. -->
    <PageSection
      v-model:open="referenceOpen"
      :description="TIER_NOTES[facts.tier]"
      :summary="referenceSummary"
      foldable
      title="Tier and key custody"
    >
      <FactGrid :columns="4" :facts="infrastructure" label="Tier and key custody" />

      <InfoNote>
        The architecture is built for SOC 2, ISO 27001, GDPR and HIPAA. No certification is
        held today, and a tier here describes the controls a project runs under rather than a
        certificate anybody has issued.
      </InfoNote>
    </PageSection>

    <SaveStatus :last-saved="lastSaved" :saving="saving" />

    <DangerZone
      :disabled="!projects.canDelete"
      :reason="
        projects.canDelete
          ? ''
          : 'It is the only project in this organisation, and an organisation with none has nothing for its members to sign in to. Make another one first.'
      "
      action="Delete project"
      description="Everything in it, and the key that makes the encrypted parts readable."
      title="Delete this project"
      @confirm="deleteOpen = true"
    >
      <ul class="m-0 flex list-none flex-col gap-1.5 p-0 text-xs leading-5 text-ink/70">
        <li v-for="effect in DELETE_EFFECTS.slice(0, 3)" :key="effect.id" class="flex items-start gap-2">
          <Icon :name="effect.icon" aria-hidden="true" class="mt-0.5 flex-none text-sm text-error/70" />
          {{ effect.label }}
        </li>
        <li class="mt-1 text-ink/50">
          The dialog lists what goes and what is kept, with the counts, before anything
          happens.
        </li>
      </ul>
    </DangerZone>

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

<script setup lang="ts">
/**
 * The project's own row, and the short list of it a customer may change (PROJECT.md 4.13).
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
 * label for this dashboard that reaches no end user anywhere, because we render no page
 * they could read it on. Retention drives the purge worker, and PROJECT.md 4.13.6 is blunt
 * about why it matters: retention that is not enforced by a job is not retention. The audit
 * subject is the exception in that card, fixed by the tier, because its age is what an
 * auditor is promised rather than what an operator prefers.
 *
 * The counts in the sidebar exist for the bottom of the page. A danger zone that says
 * "this cannot be undone" and shows nothing is a danger zone somebody clicks through; the
 * difference between an experiment and production is three numbers, and the delete dialog
 * repeats them where the decision is actually made.
 */

import { isLive } from "~/utils/keys";
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
const users = useUsersStore();
const sessions = useSessionsStore();
const keys = useKeysStore();
const audit = useAuditStore();

const now = useNow({ interval: 60_000 });

const facts = computed(() => store.factsFor(projects.current.id, projects.current.name));
const cell = computed(() => cellByCode(facts.value.cellCode));
const retention = computed(() => store.retentionFor(projects.current.id, facts.value.tier));

/** What is in the project, for the sidebar and for the dialog that ends it. */
const counts = computed(() => {
  const held = sessions.forProject(projects.current.id);
  return {
    users: users.forProject(projects.current.id).filter((user) => user.deletedAt === null).length,
    sessions: countSessionsByStatus(held, now.value).active,
    keys: keys.keysFor(projects.current.id).filter(isLive).length,
    audit: audit.forProject(projects.current.id).length,
  };
});

/* Which cards start unfolded. Custody is the one people read once and never again. */
const expanded = reactive({ custody: false });

/*
 * Saving. Every control writes itself, like the other settings screens.
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

function setRetention(subject: RetentionSubject, maxAge: string) {
  if (retention.value[subject] === maxAge) return;
  void whileBusy(subject, () => store.setRetention(projects.current.id, subject, maxAge));
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

/* A dialog belongs to the project it was opened from. */
watch(
  () => projects.current.id,
  () => {
    nameOpen.value = false;
    deleteOpen.value = false;
  },
);

/* The column stores a lowercase token; a badge is display and reads as a word. */
const planLabel = computed(
  () => facts.value.plan.charAt(0).toUpperCase() + facts.value.plan.slice(1),
);

const saving = computed(() => busy.value.size > 0);
const lastSaved = computed(() => store.lastSavedAt(projects.current.id));

const GUIDES_URL = "https://idenzy.dev/docs/projects";

const GUIDES = [
  {
    icon: "material-symbols:database-outline",
    title: "Projects and tenancy",
    detail: "Why a project is the boundary, and what that means for a test environment.",
    href: GUIDES_URL,
  },
  {
    icon: "material-symbols:public",
    title: "Residency and cells",
    detail: "What an EU project is resident in, and what the control plane holds instead.",
    href: `${GUIDES_URL}/residency`,
  },
  {
    icon: "material-symbols:lock-outline",
    title: "Keys and custody",
    detail: "The per-project data key, the cell key that wraps it, and who can use either.",
    href: `${GUIDES_URL}/encryption`,
  },
  {
    icon: "material-symbols:mop-outline",
    title: "Retention and purges",
    detail: "What the purge worker sweeps, on what schedule, and what it deliberately keeps.",
    href: `${GUIDES_URL}/retention`,
  },
];
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:settings-outline" title="General">
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

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <div class="flex min-w-0 flex-col gap-6">
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

            <SettingRow
              description="Members, roles and billing belong to the organisation rather than to one of its projects, which is why they are not on this screen."
              :fixed="facts.orgName"
              label="Organisation"
            >
              <template #actions>
                <v-btn
                  class="text-xs font-medium"
                  color="neutral"
                  prepend-icon="material-symbols:open-in-new"
                  size="small"
                  to="/settings/members"
                  variant="text"
                >
                  Members
                </v-btn>
              </template>
            </SettingRow>

            <SettingRow
              description="What this project is metered and billed against. The plan is the organisation's, so changing it changes it everywhere."
              :fixed="planLabel"
              label="Plan"
            >
              <template #actions>
                <v-btn
                  class="text-xs font-medium"
                  color="neutral"
                  prepend-icon="material-symbols:open-in-new"
                  size="small"
                  to="/settings/billing"
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

        <LayerCard
          :description="TIER_NOTES[facts.tier]"
          title="Compliance tier"
        >
          <template #badge>
            <StatusBadge
              :label="TIER_LABELS[facts.tier]"
              :tone="facts.tier === 'hipaa' ? 'success' : 'neutral'"
            />
          </template>

          <div class="divide-y divide-line">
            <SettingRow
              :description="`Audit partitions are dropped on this schedule, and the tier is the only thing that sets it. Raising it later does not bring back a partition already dropped.`"
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
            class="m-0 mt-5 flex items-start gap-2 rounded-(--idenzy-radius-small) border border-line bg-canvas px-3 py-2.5 text-[11px] leading-4 text-ink/65"
          >
            <Icon
              aria-hidden="true"
              class="mt-px flex-none text-sm text-ink/40"
              name="material-symbols:info-outline"
            />
            <span>
              The architecture is built for SOC 2, ISO 27001, GDPR and HIPAA. No certification
              is held today, and a tier here describes the controls a project runs under
              rather than a certificate anybody has issued.
            </span>
          </p>
        </LayerCard>

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
                  <span class="font-mono">{{ retentionLabel(retention[subject]) }}</span>
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
                      :loading="isBusy(subject)"
                      class="text-xs font-medium"
                      color="neutral"
                      size="small"
                      variant="text"
                    >
                      <span class="font-mono">{{ retentionLabel(retention[subject]) }}</span>
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
                      :active="retention[subject] === choice"
                      :title="retentionLabel(choice)"
                      @click="setRetention(subject, choice)"
                    />
                  </v-list>
                </v-menu>
              </template>
            </SettingRow>
          </div>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.custody"
          expandable
          description="Where this project's keys are, who can use them, and why one project cannot read another. Nothing here is configurable and each row says why not."
          title="Keys and isolation"
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

        <!-- Its own frame rather than a LayerCard, because this is the one place on the page
             where the weight should differ before anything is read. -->
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

          <div
            class="overflow-hidden rounded-(--idenzy-radius) border border-line bg-surface p-5"
          >
            <div class="flex flex-wrap items-center justify-between gap-4">
              <ul class="m-0 flex list-none flex-col gap-1.5 p-0 text-xs leading-5 text-ink/70">
                <li v-for="effect in DELETE_EFFECTS.slice(0, 3)" :key="effect.id" class="flex items-start gap-2">
                  <Icon
                    :name="effect.icon"
                    aria-hidden="true"
                    class="mt-0.5 flex-none text-sm text-error/70"
                  />
                  {{ effect.label }}
                </li>
              </ul>
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
            </div>
            <p class="m-0 mt-4 text-[11px] leading-4 text-ink/50">
              The billing record survives, pseudonymously, for six years: statutory financial
              record keeping requires it and it names none of your users. The dialog lists
              that and the rest before anything happens.
            </p>
          </div>
        </section>
      </div>

      <aside class="flex flex-col gap-4 xl:sticky xl:top-20">
        <div class="flex items-baseline justify-between px-1">
          <h2 class="m-0 text-base font-semibold tracking-tight text-ink">In this project</h2>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <UsageTile
            :seed="91"
            :value="counts.users"
            info="Accounts that are not tombstones. What a deletion of this project would take with it."
            label="Users"
          />
          <UsageTile
            :seed="93"
            :value="counts.sessions"
            info="Sessions that would answer a request right now, across every account."
            label="Live sessions"
          />
          <UsageTile
            :seed="95"
            :value="counts.keys"
            info="Publishable and secret keys that still resolve. Anything holding one stops working if the project goes."
            label="Live keys"
          />
          <UsageTile
            :seed="97"
            :value="counts.audit"
            info="Entries in the hash chain. Export what an auditor will ask for before the project is deleted, because the partitions go with it."
            label="Audit entries"
          />
        </div>

        <LayerCard :padded="false" title="Guides">
          <ul class="m-0 list-none divide-y divide-line p-0">
            <li v-for="guide in GUIDES" :key="guide.href">
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

        <SaveStatus :last-saved="lastSaved" :saving="saving" />
      </aside>
    </div>

    <ProjectNameDialog
      v-model="nameOpen"
      :busy="isBusy('name')"
      :current="projects.current.name"
      @confirm="confirmName"
    />

    <ProjectDeleteDialog
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

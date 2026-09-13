<script setup lang="ts">
/**
 * Auth domains: the host a customer's own pages send their API calls to (PROJECT.md 4.3,
 * notes/domains.md).
 *
 * The screen exists to say one sentence correctly. An auth domain is an API host and never
 * a page: `auth.customer.com` is a CNAME at our load balancer that a customer's React or
 * Nuxt page sends `fetch` calls to. Nobody navigates to it, it serves no HTML, and the
 * sign-in screen stays wherever the customer built it. Left unsaid, "you need an auth
 * domain" reads as "we host your sign-in screen", which is the one thing this product does
 * not do (ADR-0002).
 *
 * It opens on the host in force, because that is the value somebody came to copy, and on
 * what the transport can do with it. The two capability rows are written as states rather
 * than as refusals: header mode on the shared host is a legitimate integration, and
 * "Cookie mode: Refused" over a project that is working exactly as intended reads as an
 * incident report. What a domain buys is named instead, with the control that starts it.
 *
 * Setting one up is a dialog off a row, the way the sending-domain and revocation setups
 * open. Its last two steps are the reason the note exists: verification and client
 * migration are different acts, and a verified host does not change a deployed base URL or
 * make an unrelated application origin same-site with it. So `Update SDK` hands over the
 * exact URL and says nothing has happened until it ships, and the check names what it
 * covers and what it cannot see from here.
 *
 * Everything copyable is built from `apiBaseUrl` over the project's own domains, so the
 * endpoint written here is the endpoint written everywhere else, and an illustrative value
 * says that it is one.
 */
import { ErrorCode } from "@idenzy/protocol/errors/codes";
import type { RecordColumn } from "~/components/RecordTable.vue";
import {
  AUTH_DOMAIN_CAPABILITIES,
  type AuthDomain,
  apiBaseUrl,
  cookieModeState,
  EXAMPLE_AUTH_HOST,
  effectiveHost,
  headerModeState,
  liveDomain,
  SHARED_API_HOST,
  siteOf,
} from "~/utils/auth-domains";
import { isRefusal } from "~/utils/sign-in-errors";

const projects = useProjectStore();
const store = useAuthDomainsStore();
const origins = useOriginsStore();

const now = useNow({ interval: 30_000 });

/* What a domain changes is reference, and it starts folded: the list is the visit. */
const expanded = reactive({ capabilities: false });

const project = computed(() => projects.current.id);

/* Read when the screen opens and again whenever the project changes. `forProject` is
   deliberately synchronous — it is read in a computed, and a fetch inside one is a request
   per render — so something has to fill the cache, and this is it. */
watch(
  project,
  (id) => {
    void store.load(id);
    /* The origins store too: the setup dialog's check says whether the operator's own
       application origin may call this host, and it reads that list. */
    void origins.load(id);
  },
  { immediate: true },
);

function reload() {
  void store.load(project.value);
}

const domains = computed(() => store.forProject(projects.current.id));
const live = computed(() => liveDomain(domains.value));
const host = computed(() => effectiveHost(domains.value));
const baseUrl = computed(() => apiBaseUrl(host.value));
const custom = computed(() => live.value !== null);

const allowedOrigins = computed(() =>
  origins.forProject(projects.current.id).map((entry) => entry.origin),
);

const header = headerModeState();
const cookies = computed(() => cookieModeState(domains.value));

const headerBadge = computed(() => {
  if (store.loading) return { label: "Reading", tone: "neutral" as const };
  /* Not "shared host", which would be a claim about a project whose domains we failed to
     read. A badge is the one thing on the page somebody reads without reading. */
  if (store.refusal !== null) return { label: "Not read", tone: "warning" as const };
  if (custom.value) return { label: "Your domain", tone: "success" as const };
  if (domains.value.length > 0) return { label: "Waiting on DNS", tone: "warning" as const };
  return { label: "Shared host", tone: "neutral" as const };
});

/* The rows on their way to the server, so each one shows its own wait. */
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

/*
 * Adding, setting up and removing.
 */
const addOpen = ref(false);
const addError = ref("");
const setupId = ref<string | null>(null);
const setupOpen = ref(false);
const setupError = ref("");

const setupDomain = computed<AuthDomain | null>(
  () => domains.value.find((domain) => domain.id === setupId.value) ?? null,
);

function openAdd() {
  addError.value = "";
  addOpen.value = true;
}

function openSetup(domain: AuthDomain) {
  setupError.value = "";
  setupId.value = domain.id;
  setupOpen.value = true;
}

function addDomain(domain: string) {
  void whileBusy("add", async () => {
    addError.value = "";
    try {
      const created = await store.add(projects.current.id, domain);
      addOpen.value = false;
      /* Straight into the setup, on the row the server answered with: the records are the
         whole of what is left to do, and a row that says "waiting on DNS" answers nothing
         on its own. */
      openSetup(created);
      notify(`${domain} added. Publish its two records and it goes live on the next check.`);
    } catch (cause: unknown) {
      /* A conflict is the one refusal that earns its own sentence, and it deliberately does
         not say whether the hostname is held by this organisation or by a stranger. */
      addError.value = isRefusal(cause, ErrorCode.Conflict)
        ? "That hostname is already claimed. A hostname belongs to one project, across every project and both kinds of domain."
        : "The domain was not added. Nothing changed, so try again.";
    }
  });
}

function recheck() {
  const row = setupDomain.value;
  if (row === null) return;
  void whileBusy(row.id, async () => {
    setupError.value = "";
    try {
      const checked = await store.recheck(projects.current.id, row.id);
      /* What the check found, because it is the answer: a row can come back verified, and
         it can come back with a record that still does not resolve. */
      notify(
        checked.status === "verified"
          ? `${row.domain} is verified. Both records resolve.`
          : `Checked ${row.domain}. Not every record has resolved yet.`,
      );
    } catch {
      setupError.value =
        "The check did not run, so nothing about the records has changed. Try again.";
    }
  });
}

async function verify(origin: string) {
  const row = setupDomain.value;
  if (row === null) return;
  await whileBusy("probe", async () => {
    setupError.value = "";
    try {
      await store.checkSetup(
        projects.current.id,
        row.id,
        origin,
        allowedOrigins.value.includes(origin.trim()),
      );
    } catch {
      setupError.value =
        "The check did not run, so nothing about the records has changed. Try again.";
    }
  });
}

/*
 * Removing. The subject is held here rather than passed down, so the dialog keeps it
 * while it closes.
 */
const removing = ref<AuthDomain | null>(null);
const removeOpen = ref(false);
const removeError = ref("");

function askRemove(domain: AuthDomain) {
  removeError.value = "";
  removing.value = domain;
  removeOpen.value = true;
}

function confirmRemove() {
  const row = removing.value;
  if (row === null) return;
  void whileBusy(row.id, async () => {
    removeError.value = "";
    try {
      await store.remove(projects.current.id, row.id);
      removeOpen.value = false;
      setupOpen.value = false;
      notify(`${row.domain} removed`);
    } catch {
      removeError.value = "The domain was not removed, so nothing has changed. Try again.";
    }
  });
}

/* A dialog belongs to the project it was opened from. */
watch(
  () => projects.current.id,
  () => {
    addOpen.value = false;
    removeOpen.value = false;
    setupOpen.value = false;
    removing.value = null;
    setupId.value = null;
  },
);

/*
 * The list.
 */

const LIST_COLUMNS: readonly RecordColumn[] = [
  { key: "domain", label: "Domain", width: "minmax(0, 1.6fr)" },
  { key: "dns", label: "DNS", width: "132px" },
  { key: "certificate", label: "Certificate", width: "140px" },
  { key: "checked", label: "Last checked", width: "116px" },
  { key: "manage", label: "Manage", width: "116px", align: "end" },
];

const listHeading = computed(() => {
  /* A failed re-read keeps the rows it already had, and the heading says which of the two
     this is: nothing known, or something known and now a read behind. */
  if (store.refusal !== null)
    return domains.value.length === 0
      ? "This project's domains could not be read"
      : "The last read failed, so these are the domains from before it";
  if (domains.value.length === 0) return "This project uses the shared host";
  if (custom.value) return `Answering on ${live.value?.domain}`;
  return domains.value.length === 1
    ? "One domain waiting on DNS"
    : `${domains.value.length} domains waiting on DNS`;
});

/*
 * What has called the host, which is nothing anybody counts yet.
 *
 * Requests per host are not metered: the figures a project has are billing's, and they do
 * not say which hostname a call arrived on. The tiles are here rather than absent because
 * the question is a real one and the honest answer is a shape with no series in it, said
 * in words under the figure.
 */
const CONNECTED_FIGURES: readonly { label: string; seed: number; info: string }[] = [
  {
    label: "Requests",
    seed: 11,
    info: "API calls this project answered, whichever host they arrived on.",
  },
  {
    label: "On your domain",
    seed: 17,
    info: "How many of them arrived on a host of yours rather than on the shared one.",
  },
  {
    label: "Origins seen",
    seed: 23,
    info: "Distinct browser origins that called. Which of them are permitted is the CORS allowlist, and that is a list rather than a measurement.",
  },
  {
    label: "Cookie-mode sessions",
    seed: 29,
    info: "Sessions holding a __Host- cookie rather than a token in the client. Only a verified domain of your own can produce one.",
  },
];

const toast = ref("");
const toastOpen = ref(false);

function notify(text: string) {
  toast.value = text;
  toastOpen.value = true;
}

const GUIDES_URL = "https://idenzy.io/docs/domains/auth";
</script>

<template>
  <div class="flex w-full flex-col gap-6">
    <PageHeader title="Auth domains">
      <template #badge>
        <StatusBadge :label="headerBadge.label" :tone="headerBadge.tone" />
      </template>
      <template #description>
        A host of your own for
        <span class="font-medium text-ink">{{ projects.current.name }}</span
        >'s API calls. It is an API host and never a page: your own sign-in screen stays
        where it is, and nothing here changes what you render.
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
          Domain guides
        </v-btn>
        <FancyButton :disabled="isBusy('add')" @click="openAdd()">
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
          Add domain
        </FancyButton>
      </template>
    </PageHeader>

    <!--
      The host in force, which is the value somebody came to copy, and what the transport
      can do with it. Both capability rows are states rather than refusals: header mode on
      the shared host is a legitimate integration and must not read as an incident.
    -->
    <v-card border flat>
      <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 p-4">
        <div class="flex min-w-0 flex-1 basis-80 flex-col gap-1.5">
          <span class="text-[11px] leading-4 text-ink/45">
            Every API call from your pages goes to
          </span>
          <span
            v-if="store.loading"
            class="my-1 block h-4 w-64 max-w-full animate-pulse rounded-full bg-ink/8"
          />
          <CopyField v-else :value="baseUrl" label="Copy the API base URL" wrap />
          <span class="text-[11px] leading-4 text-ink/50">
            <!-- A read that failed is not a project on the shared host, and the line under
                 the value it copied has to say which of the two this is. -->
            <template v-if="store.refusal">
              This project's domains could not be read, so this is our shared host rather than
              an answer about yours.
            </template>
            <template v-else-if="custom">
              A host of yours, so this is the value your client is configured with.
            </template>
            <template v-else>
              Ours, and it works. A domain of your own replaces this value and nothing else.
            </template>
          </span>
        </div>
      </div>

      <div class="grid gap-px border-t border-line bg-line sm:grid-cols-3">
        <div class="flex flex-col gap-1 bg-surface p-4">
          <span class="text-[11px] leading-4 text-ink/45">Header mode</span>
          <span class="text-xs font-medium text-ink">{{ header.label }}</span>
          <span class="text-[11px] leading-4 text-ink/50">{{ header.detail }}</span>
        </div>

        <div class="flex flex-col gap-1 bg-surface p-4">
          <span class="text-[11px] leading-4 text-ink/45">Cookie mode</span>
          <span
            :class="cookies.state === 'ready' ? 'text-success' : 'text-ink'"
            class="text-xs font-medium"
          >
            {{ cookies.label }}
          </span>
          <span class="text-[11px] leading-4 text-ink/50">{{ cookies.detail }}</span>
          <!-- A setup action rather than a refusal: the state is a thing to start, not a
               thing that failed (notes/domains.md P2). -->
          <button
            v-if="cookies.action"
            class="mt-0.5 inline-flex w-fit items-center gap-0.5 text-[11px] font-medium text-ink transition-colors duration-150 hover:underline"
            type="button"
            @click="
              cookies.action === 'Add a domain' ? openAdd() : domains[0] && openSetup(domains[0])
            "
          >
            {{ cookies.action }}
            <Icon aria-hidden="true" class="text-sm" name="material-symbols:chevron-right" />
          </button>
        </div>

        <div class="flex flex-col gap-1 bg-surface p-4">
          <span class="text-[11px] leading-4 text-ink/45">Same-site with</span>
          <span class="font-mono text-xs break-all text-ink">
            {{ live ? siteOf(live.domain) : "—" }}
          </span>
          <span class="text-[11px] leading-4 text-ink/50">
            <template v-if="live">
              Any page under this site can hold a cookie the host sets. Everything else is
              cross-site and stays in header mode.
            </template>
            <template v-else>
              SameSite is a site rule, so nothing is same-site with our shared host. This is
              what a domain on your own site changes.
            </template>
          </span>
        </div>
      </div>
    </v-card>

    <!--
      What has called the host. Nothing meters requests per hostname, so the tiles say so
      in words rather than drawing a chart of nothing.
    -->
    <section class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">Connected applications</h2>
        <span class="text-xs text-ink/55">Last 30 days</span>
      </header>

      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <UsageTile
          v-for="figure in CONNECTED_FIGURES"
          :key="figure.label"
          :info="figure.info"
          :label="figure.label"
          :seed="figure.seed"
          :value="0"
        />
      </div>

      <p class="m-0 text-[11px] leading-4 text-ink/55">
        Nothing counts requests per host yet, so these are the tiles as they will read. What
        is registered rather than observed is the CORS allowlist on
        <NuxtLink class="font-medium text-ink" to="/domains/origins">Allowed origins</NuxtLink>,
        and where your mail comes from is a different table again on
        <NuxtLink class="font-medium text-ink" to="/email/domains">Sending domains</NuxtLink>.
      </p>
    </section>

    <!--
      The list. DNS and the certificate are two columns because they fail separately and
      are fixed by two different records.
    -->
    <section class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-col gap-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">
          {{ store.loading ? "Reading this project's domains" : listHeading }}
        </h2>
        <p class="m-0 text-xs leading-5 text-ink/55">
          A hostname belongs to one project, across every project and both kinds of domain.
          Only a verified one resolves: while a domain waits on DNS, a request to it is
          refused as an unknown project rather than as a host that is nearly ready.
        </p>
      </header>

      <!-- A read that failed says so and offers the read again. Left to the empty state
           below, it would tell somebody their project has no domains. Rows already read
           stay under it: they are a read behind and that is better than gone. -->
      <div v-if="store.refusal" class="flex flex-col items-start gap-2.5">
        <InfoNote :text="store.refusal" icon="material-symbols:error-outline" tone="warning" />
        <v-btn
          :loading="store.loading"
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:refresh"
          size="small"
          variant="outlined"
          @click="reload()"
        >
          Try again
        </v-btn>
      </div>

      <RecordTable
        v-if="store.refusal === null || domains.length > 0"
        :columns="LIST_COLUMNS"
        framed
        label="Auth domains"
      >
        <template v-if="store.loading">
          <li v-for="row in 2" :key="row" class="record-row">
            <span class="record-cell record-cell--primary flex items-center gap-3">
              <span
                class="size-7 flex-none animate-pulse rounded-(--idenzy-radius-x-small) bg-ink/8"
              />
              <span class="flex min-w-0 flex-1 flex-col gap-1.5">
                <span class="h-2.5 w-40 animate-pulse rounded-full bg-ink/8" />
                <span class="h-2 w-56 animate-pulse rounded-full bg-ink/6" />
              </span>
            </span>
            <span class="record-cell record-cell--half">
              <span class="block h-4 w-20 animate-pulse rounded-full bg-ink/8" />
            </span>
            <span class="record-cell record-cell--half">
              <span class="block h-4 w-20 animate-pulse rounded-full bg-ink/8" />
            </span>
            <span class="record-cell record-cell--half">
              <span class="block h-2 w-14 animate-pulse rounded-full bg-ink/6" />
            </span>
            <span class="record-cell record-cell--action" />
          </li>
        </template>

        <template v-else>
          <AuthDomainRow
            v-for="domain in domains"
            :key="domain.id"
            :busy="isBusy(domain.id)"
            :domain="domain"
            :now="now"
            @open="openSetup(domain)"
            @remove="askRemove(domain)"
          />
        </template>

        <!-- The empty state is where the framing has to land, and it leads with the choice
             rather than with the architecture behind it (notes/domains.md P1). -->
        <template #empty>
          <div
            v-if="!store.loading && domains.length === 0"
            class="flex flex-col items-center gap-1.5 px-4 py-12 text-center"
          >
            <Icon
              aria-hidden="true"
              class="mb-1 text-2xl text-ink/25"
              name="material-symbols:language"
            />
            <p class="m-0 text-sm font-medium text-ink">
              Use <span class="font-mono">{{ EXAMPLE_AUTH_HOST }}</span> for authentication
              requests
            </p>
            <p class="m-0 max-w-lg text-xs leading-5 text-ink/55">
              A host on your own site, so the refresh token can live in a cookie the browser
              will not hand to script. It takes two DNS records and about ten minutes, most of
              it waiting, and it needs access to the zone that answers for your site.
            </p>
            <p class="m-0 max-w-lg text-xs leading-5 text-ink/50">
              Everything already works without one on
              <span class="font-mono text-ink/70">{{ SHARED_API_HOST }}</span> in header mode,
              so this is a choice rather than a setup step.
            </p>
            <FancyButton class="mt-2" @click="openAdd()">
              <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
              Add domain
            </FancyButton>
          </div>
        </template>
      </RecordTable>
    </section>

    <LayerCard
      v-model:open="expanded.capabilities"
      :padded="false"
      description="Three things behave differently with a host of your own, and each one is a specific answer rather than a feature that is off."
      expandable
      title="What a domain changes"
    >
      <ul class="m-0 list-none divide-y divide-line p-0">
        <li
          v-for="capability in AUTH_DOMAIN_CAPABILITIES"
          :key="capability.id"
          class="flex flex-col gap-2 px-4 py-3.5"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs font-medium text-ink">{{ capability.title }}</span>
            <span
              v-if="capability.errorCode"
              class="rounded-full bg-ink/4 px-1.5 font-mono text-[10px] leading-4 whitespace-nowrap text-ink/55 ring-1 ring-ink/6 ring-inset"
            >
              {{ capability.errorCode }}
            </span>
          </div>
          <div class="grid gap-2 sm:grid-cols-2">
            <p class="m-0 text-[11px] leading-4 text-ink/55">
              <span class="font-medium text-ink/75">With a domain.</span>
              {{ capability.with }}
            </p>
            <p class="m-0 text-[11px] leading-4 text-ink/55">
              <span class="font-medium text-ink/75">On the shared host.</span>
              {{ capability.without }}
            </p>
          </div>
        </li>
      </ul>
    </LayerCard>

    <!-- Mounted only while open, like every dialog here that writes and then closes. -->
    <AuthDomainAddDialog
      v-if="addOpen"
      v-model="addOpen"
      :error="addError"
      :existing="domains.map((domain) => domain.domain)"
      :saving="isBusy('add')"
      @add="addDomain"
    />

    <AuthDomainSetupDialog
      v-if="setupOpen && setupDomain"
      v-model="setupOpen"
      :busy="isBusy(setupDomain.id)"
      :checking="isBusy('probe')"
      :domain="setupDomain"
      :error="setupError"
      :origins="allowedOrigins"
      :probe="store.probeFor(projects.current.id)"
      @recheck="recheck"
      @remove="askRemove(setupDomain)"
      @verify="verify"
    />

    <AuthDomainRemoveDialog
      v-if="removeOpen && removing"
      v-model="removeOpen"
      :domain="removing"
      :error="removeError"
      :removing="isBusy(removing.id)"
      @confirm="confirmRemove"
    />

    <v-snackbar
      v-model="toastOpen"
      :timeout="3000"
      color="surface"
      location="bottom right"
      rounded="lg"
      variant="flat"
    >
      <span class="text-xs text-ink">{{ toast }}</span>
    </v-snackbar>
  </div>
</template>

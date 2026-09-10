<script setup lang="ts">
/**
 * Auth domains: the host a customer's own pages send their API calls to (PROJECT.md 4.3,
 * `apps/auth-api/src/session/session-transport.guard.ts`).
 *
 * The screen exists to say one sentence correctly. An auth domain is an API host and never
 * a page: `auth.customer.com` is a CNAME at our load balancer that a customer's React or
 * Nuxt page sends `fetch` calls to. Nobody navigates to it, it serves no HTML, and the
 * sign-in screen stays wherever the customer built it. Left unsaid, "you need an auth
 * domain" reads as "we host your sign-in screen", which is the one thing this product does
 * not do (ADR-0002), so the page opens with what it is not.
 *
 * It is optional, and the screen says so before it asks for anything. Header mode works on
 * the shared host and always has, so a project can ignore this entirely; what a domain buys
 * is cookie mode, the routes a browser navigates to, and a strict preflight. Each of those
 * is stated as what happens without one rather than as a feature that is off, because in
 * every case the answer is a specific refusal a customer will otherwise meet in a log.
 *
 * The state worth being careful about is pending. `resolve_project_by_host` matches only a
 * verified row, so while a domain is waiting on DNS a request to it is refused as an
 * unknown project rather than as a domain that is nearly ready. Nothing in that refusal
 * points here, which is why the row says it in words.
 */
import {
  AUTH_DOMAIN_CAPABILITIES,
  type AuthDomain,
  effectiveHost,
  liveDomain,
  SHARED_API_HOST,
  siteOf,
} from "~/utils/auth-domains";

const projects = useProjectStore();
const store = useAuthDomainsStore();

const now = useNow({ interval: 30_000 });

/* Which cards start unfolded. The domain and what it buys are what a visit is for. */
const expanded = reactive({ capabilities: true, rules: false });

const domains = computed(() => store.forProject(projects.current.id));
const live = computed(() => liveDomain(domains.value));
const host = computed(() => effectiveHost(domains.value));
const custom = computed(() => live.value !== null);

/* The fields on their way to the server, so each row shows its own wait. */
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

const working = computed(() => busy.value.size > 0);

/*
 * Adding.
 */
const addOpen = ref(false);

function addDomain(domain: string) {
  void whileBusy("add", async () => {
    await store.add(projects.current.id, domain);
    addOpen.value = false;
    notify(`${domain} added. Publish its two records and it goes live on the next check.`);
  });
}

function recheck(domain: AuthDomain) {
  void whileBusy(domain.id, async () => {
    await store.recheck(projects.current.id, domain.id);
    notify(`Checked ${domain.domain}`);
  });
}

/*
 * Removing. The subject is held here rather than passed down, so the dialog keeps it
 * while it closes.
 */
const removing = ref<AuthDomain | null>(null);
const removeOpen = ref(false);

function askRemove(domain: AuthDomain) {
  removing.value = domain;
  removeOpen.value = true;
}

function confirmRemove() {
  const row = removing.value;
  if (row === null) return;
  void whileBusy(row.id, async () => {
    await store.remove(projects.current.id, row.id);
    removeOpen.value = false;
    notify(`${row.domain} removed`);
  });
}

/* A dialog belongs to the project it was opened from. */
watch(
  () => projects.current.id,
  () => {
    addOpen.value = false;
    removeOpen.value = false;
    removing.value = null;
  },
);

const { copy } = useClipboard();

async function copyHost() {
  await copy(`https://${host.value}`);
  notify("API base URL copied");
}

const toast = ref("");
const toastOpen = ref(false);

function notify(text: string) {
  toast.value = text;
  toastOpen.value = true;
}

const GUIDES = [
  {
    icon: "material-symbols:language",
    title: "Custom auth domains",
    detail: "What one is, what it is not, and the two records that make it work.",
    href: "https://idenzy.dev/docs/domains/auth",
  },
  {
    icon: "material-symbols:cookie-outline",
    title: "Cookie mode",
    detail: "Why SameSite decides it, and what the SDK does when it cannot be had.",
    href: "https://idenzy.dev/docs/sdk/js/transport",
  },
  {
    icon: "material-symbols:swap-horiz",
    title: "OAuth without an auth domain",
    detail: "The JSON twin your page calls and then navigates itself.",
    href: "https://idenzy.dev/docs/oauth/start",
  },
  {
    icon: "material-symbols:dns-outline",
    title: "DNS and certificates",
    detail: "The CNAME, the authorisation record, and why renewal depends on it.",
    href: "https://idenzy.dev/docs/domains/dns",
  },
];
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:language" title="Auth domains">
      <template #description>
        A host of your own for
        <span class="font-medium text-ink">{{ projects.current.name }}</span
        >'s API calls. It is an API host and never a page: your own sign-in screen stays
        where it is, and nothing here changes what you render.
      </template>
      <template #actions>
        <FancyButton v-if="domains.length > 0" :disabled="isBusy('add')" @click="addOpen = true">
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
          Add a domain
        </FancyButton>
      </template>
    </PageHeader>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <div class="flex min-w-0 flex-col gap-6">
        <LayerCard :padded="false" title="Your domains">
          <template #badge>
            <StatusBadge
              :label="custom ? 'Live' : domains.length > 0 ? 'Waiting on DNS' : 'Shared host'"
              :tone="custom ? 'success' : domains.length > 0 ? 'warning' : 'neutral'"
            />
          </template>

          <p v-if="store.loading" class="m-0 px-4 py-8 text-center text-xs text-ink/50">
            Reading the domains.
          </p>

          <!-- The empty state is where the framing has to land, because a project with no
               domain is the one most likely to misread what adding one would do. -->
          <EmptyState
            v-else-if="domains.length === 0"
            icon="material-symbols:language"
            title="This project uses the shared host"
          >
            <template #description>
              Everything works on
              <span class="font-mono text-ink/80">{{ SHARED_API_HOST }}</span> already, in
              header mode. A domain of your own is a CNAME at our load balancer that your
              pages call instead, and what it buys is cookie mode and the routes a browser
              navigates to. It hosts nothing: your sign-in screen stays where you built it.
            </template>
            <template #actions>
              <FancyButton :disabled="isBusy('add')" @click="addOpen = true">
                <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
                Add a domain
              </FancyButton>
            </template>
          </EmptyState>

          <ul v-else class="m-0 list-none divide-y divide-line p-0">
            <li v-for="domain in domains" :key="domain.id">
              <AuthDomainRow
                :busy="isBusy(domain.id)"
                :domain="domain"
                :now="now"
                @recheck="recheck(domain)"
                @remove="askRemove(domain)"
              />
            </li>
          </ul>

          <div
            class="flex flex-col gap-1 border-t border-line bg-canvas/60 px-4 py-3 text-[11px] leading-4 text-ink/60"
          >
            <p class="m-0">
              <span class="font-medium text-ink">A hostname belongs to one project.</span>
              The index is on the domain alone, across every project and both kinds of
              domain, so a name claimed here cannot be claimed anywhere else.
            </p>
            <p class="m-0">
              <span class="font-medium text-ink">Only a verified domain resolves.</span> While
              one is waiting on DNS, a request to it is refused as an unknown project rather
              than as a domain that is nearly ready, and nothing in that refusal points here.
            </p>
          </div>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.capabilities"
          :description="
            custom
              ? 'What this project has because a domain is live.'
              : 'What a domain would buy. Each of these has an answer today rather than simply being off.'
          "
          expandable
          title="What it changes"
        >
          <div class="divide-y divide-line">
            <SettingRow
              v-for="capability in AUTH_DOMAIN_CAPABILITIES"
              :key="capability.id"
              :label="capability.title"
            >
              <template #description>
                {{ custom ? capability.with : capability.without }}
              </template>
              <template #actions>
                <span
                  v-if="!custom && capability.errorCode"
                  class="rounded-full border border-line px-1.5 font-mono text-[10px] leading-4 whitespace-nowrap text-ink/55"
                >
                  {{ capability.errorCode }}
                </span>
                <span
                  v-else
                  class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium whitespace-nowrap text-ink/55"
                >
                  {{ custom ? "Yours" : "Browser's" }}
                </span>
              </template>
            </SettingRow>
          </div>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.rules"
          description="What the host does, what it refuses, and the two things about DNS that bite later rather than now."
          expandable
          title="How it behaves"
        >
          <div class="divide-y divide-line">
            <SettingRow label="What it serves">
              <template #description>
                JSON and HTTP redirects, and nothing else. A
                <span class="font-mono text-ink/80">Content-Type</span> of
                <span class="font-mono text-ink/80">text/html</span> from this host is a bug
                with a test asserting against it. That is what makes the headless decision a
                security property rather than only a product one: your Content-Security-Policy
                governs your sign-in page, and no script of ours runs on it.
              </template>
              <template #actions>
                <span
                  class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55"
                >
                  Never HTML
                </span>
              </template>
            </SettingRow>
            <SettingRow
              description="Header first, then Authorization, then Host, and it is first-present-wins rather than a chain: a header that is present and unresolvable is a hard failure. Falling through to Host would let a request that named one project execute against whatever project the Host maps to, and nobody would notice."
              fixed="Host is last"
              label="How a request finds its project"
            />
            <SettingRow
              description="Issued automatically once the authorisation record is seen, and renewed from that same record. Leave it published: removing it after the domain is working breaks renewal months later, at a moment nothing here caused and nothing obvious explains."
              fixed="Automatic"
              label="The certificate"
            />
            <SettingRow
              description="A zone's apex cannot hold a CNAME, so an auth domain is always a subdomain. That is a DNS rule rather than ours, and it is why the field refuses a bare example.com before anything is stored."
              fixed="A subdomain"
              label="Why not the apex"
            />
            <SettingRow label="Localhost">
              <template #description>
                The development exception. Everything on localhost is same-site by accident,
                so cookie mode works there without any of this, and a project can build the
                whole integration before deciding whether it wants a domain at all.
              </template>
              <template #actions>
                <span
                  class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55"
                >
                  Exempt
                </span>
              </template>
            </SettingRow>
          </div>
        </LayerCard>
      </div>

      <aside class="flex flex-col gap-4 xl:sticky xl:top-20">
        <div class="flex items-baseline justify-between px-1">
          <h2 class="m-0 text-base font-semibold tracking-tight text-ink">This project</h2>
          <span class="text-xs text-ink/55">Right now</span>
        </div>

        <LayerCard
          :padded="false"
          :description="
            custom
              ? 'Point your SDK here. Nothing navigates to it; your pages call it.'
              : 'Where your pages call today. A domain of your own replaces this value and nothing else.'
          "
          title="API base URL"
        >
          <div class="p-4">
            <CopyField :value="`https://${host}`" label="Copy the API base URL" />
          </div>
          <div class="flex flex-col gap-2.5 border-t border-line p-4 text-xs">
            <div class="flex items-center justify-between gap-3">
              <span class="text-ink/60">Cookie mode</span>
              <span :class="custom ? 'text-success' : 'text-ink/70'" class="text-[11px]">
                {{ custom ? "Available" : "Refused" }}
              </span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-ink/60">Same-site with</span>
              <span class="font-mono text-[11px] text-ink/75">
                {{ live ? siteOf(live.domain) : "Nothing" }}
              </span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-ink/60">Domains added</span>
              <span class="font-mono text-[11px] text-ink tabular-nums">{{ domains.length }}</span>
            </div>
          </div>
          <button
            class="flex w-full items-center justify-center gap-1.5 border-t border-line px-4 py-2.5 text-[11px] font-medium text-ink/70 transition-colors duration-150 hover:bg-ink/3 hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
            type="button"
            @click="copyHost"
          >
            <Icon aria-hidden="true" class="text-sm" name="material-symbols:content-copy-outline" />
            Copy for your SDK
          </button>
        </LayerCard>

        <LayerCard :padded="false" description="Not this screen's, and worth not confusing." title="The other domains">
          <ul class="m-0 flex list-none flex-col divide-y divide-line p-0 text-xs">
            <li class="flex flex-col gap-0.5 px-4 py-3">
              <NuxtLink
                class="font-medium text-ink no-underline hover:underline"
                to="/email/domains"
                >Sending domains</NuxtLink
              >
              <span class="text-[11px] leading-4 text-ink/55">
                Where your mail comes from. A different row of the same table, with DKIM and
                SPF rather than a CNAME, and no bearing on how your app calls the API.
              </span>
            </li>
            <li class="flex flex-col gap-0.5 px-4 py-3">
              <NuxtLink
                class="font-medium text-ink no-underline hover:underline"
                to="/domains/origins"
                >Allowed origins</NuxtLink
              >
              <span class="text-[11px] leading-4 text-ink/55">
                Which browser origins may call with credentials. Its own exact-match list,
                derived from nothing, and needed whether or not you have an auth domain.
              </span>
            </li>
          </ul>
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

        <SaveStatus :last-saved="store.lastChangedAt(projects.current.id)" :saving="working" />
      </aside>
    </div>

    <AuthDomainAddDialog
      v-model="addOpen"
      :existing="domains.map((domain) => domain.domain)"
      :saving="isBusy('add')"
      @add="addDomain"
    />

    <AuthDomainRemoveDialog
      v-if="removing"
      v-model="removeOpen"
      :domain="removing"
      :removing="isBusy(removing.id)"
      @confirm="confirmRemove"
    />

    <v-snackbar
      v-model="toastOpen"
      :timeout="4000"
      color="surface"
      location="bottom right"
      rounded="lg"
      variant="flat"
    >
      <span class="text-xs text-ink">{{ toast }}</span>
    </v-snackbar>
  </div>
</template>

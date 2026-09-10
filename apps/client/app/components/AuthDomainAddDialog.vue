<script setup lang="ts">
/**
 * Names a hostname to use as a custom auth domain.
 *
 * The dialog says what the thing is before it takes the name, because the words "auth
 * domain" are the ones customers most reliably misread: it is an API host their own pages
 * call, not a page we host, and somebody expecting a hosted sign-in screen should find
 * that out here rather than after changing DNS.
 *
 * The apex rule is enforced rather than explained afterwards. A zone's apex cannot hold a
 * CNAME, so `example.com` can never be an auth domain however much somebody wants it to
 * be, and refusing it while it is being typed is the difference between reading a sentence
 * and waiting on a verification that can never pass.
 *
 * The site a hostname belongs to is shown back, because that is the whole of why cookie
 * mode works: `SameSite` is a site rule, so an app anywhere under the same site is
 * same-site with it and everything else is not.
 */
import { DOMAIN_ISSUE_LABELS, normalizeDomain, siteOf, validateDomain } from "~/utils/auth-domains";

const props = defineProps<{
  /** Hostnames already on the project, so one is not added twice. */
  existing: readonly string[];
  saving: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  add: [domain: string];
}>();

const value = ref("");
const touched = ref(false);
const field = useTemplateRef<{ focus: () => void }>("field");

watch(open, (isOpen) => {
  if (!isOpen) return;
  value.value = "";
  touched.value = false;
});

const issue = computed(() => validateDomain(value.value, props.existing));
const showIssue = computed(() => touched.value && issue.value !== null);
const ready = computed(() => issue.value === null && !props.saving);

/* Only once something valid is typed, or a half-typed name would claim a site. */
const site = computed(() => (issue.value === null ? siteOf(value.value) : null));

function submit() {
  touched.value = true;
  if (!ready.value) return;
  emit("add", normalizeDomain(value.value));
}

const id = `${useId()}-domain`;
</script>

<template>
  <v-dialog v-model="open" max-width="520" @after-enter="field?.focus()">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="submit">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Add an auth domain</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            A hostname in a zone you control, pointed at our load balancer. Your pages send
            their API calls to it. Nobody navigates to it, it serves no HTML, and your
            sign-in screen stays exactly where it is.
          </p>
        </header>

        <div class="flex flex-col gap-1.5">
          <label :for="id" class="text-xs font-medium text-ink">Hostname</label>
          <v-text-field
            :id="id"
            ref="field"
            v-model="value"
            :error="showIssue"
            autocapitalize="off"
            autocomplete="off"
            class="font-mono"
            hide-details
            placeholder="auth.example.com"
            spellcheck="false"
            variant="filled"
            @blur="touched = true"
          />
          <p v-if="showIssue && issue" class="m-0 text-[11px] leading-4 text-error">
            {{ DOMAIN_ISSUE_LABELS[issue] }}
          </p>
          <p v-else-if="site" class="m-0 text-[11px] leading-4 text-ink/55">
            Cookie mode will work for any of your pages under
            <span class="font-mono text-ink/80">{{ site }}</span
            >, and for nothing outside it: SameSite is a site rule, not an origin one.
          </p>
          <p v-else class="m-0 text-[11px] leading-4 text-ink/50">
            A subdomain, because a zone's apex cannot hold a CNAME.
          </p>
        </div>

        <p class="m-0 text-[11px] leading-4 text-ink/55">
          Adding it stores the hostname and hands back two DNS records to publish. Nothing
          changes for your users until a check sees them: until then the host answers no
          request, and clients keep using the shared API host.
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
            :loading="saving"
            class="text-xs font-medium"
            color="primary"
            size="small"
            type="submit"
            variant="flat"
          >
            Add domain
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>

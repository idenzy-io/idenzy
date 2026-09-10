<script setup lang="ts">
/**
 * Adds a domain and nothing else. The identity is created, the provider hands back the
 * records, and what the project sends from does not move: that is a second decision made
 * once the records resolve, because a From line pointed at a domain whose DKIM is not
 * published yet is mail nobody can check.
 *
 * The dialog shows the two addresses the name decides before anything is created. The
 * bounce subdomain is the one people are surprised by, and finding out it exists after
 * the records are in front of them is worse than reading it here.
 */
import {
  DOMAIN_ISSUE_LABELS,
  fromAddress,
  mailFromFor,
  normaliseDomain,
  validateDomain,
} from "~/utils/sending-domains";

const props = defineProps<{
  /** The domains this project already holds, so a duplicate is refused before the call. */
  existing: readonly string[];
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [domain: string];
}>();

const typed = ref("");
/* Focused once the dialog has finished entering; `autofocus` loses to the overlay's own focus. */
const field = useTemplateRef<{ focus: () => void }>("field");

watch(open, (value) => {
  if (value) typed.value = "";
});

const domain = computed(() => normaliseDomain(typed.value));

const issue = computed(() => {
  if (typed.value.trim() === "") return "";
  const found = validateDomain(typed.value, props.existing);
  return found === null ? "" : DOMAIN_ISSUE_LABELS[found];
});

const ready = computed(() => typed.value.trim() !== "" && issue.value === "");

function confirm() {
  if (!ready.value || props.busy) return;
  emit("confirm", domain.value);
}
</script>

<template>
  <v-dialog v-model="open" max-width="480" @after-enter="field?.focus()">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Add a sending domain</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            A domain you own and can publish DNS on. We create the identity and hand back
            the records to add; nothing about what your project sends changes until you
            move the From line to it.
          </p>
        </header>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-ink" for="sending-domain">Domain</label>
          <v-text-field
            id="sending-domain"
            ref="field"
            v-model="typed"
            :error="issue !== ''"
            autocomplete="off"
            class="font-mono"
            hide-details
            placeholder="acme.com"
            variant="filled"
          />
          <p :class="issue ? 'text-error' : 'text-ink/50'" class="m-0 text-[11px] leading-4">
            {{ issue || "A subdomain is a fine choice and keeps this away from your own mail: mail.acme.com." }}
          </p>
        </div>

        <section v-if="ready" class="flex flex-col gap-2">
          <p class="m-0 text-xs leading-5 text-ink/80">Once it verifies:</p>
          <ul class="m-0 flex list-none flex-col gap-2 p-0 text-xs">
            <li class="flex items-start gap-2.5">
              <Icon
                aria-hidden="true"
                class="mt-0.5 flex-none text-sm text-ink/50"
                name="material-symbols:outgoing-mail"
              />
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="truncate font-mono text-ink">{{ fromAddress(domain) }}</span>
                <span class="text-[11px] text-ink/55">
                  The address every auth mail on this project comes from.
                </span>
              </span>
            </li>
            <li class="flex items-start gap-2.5">
              <Icon
                aria-hidden="true"
                class="mt-0.5 flex-none text-sm text-ink/50"
                name="material-symbols:u-turn-left"
              />
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="truncate font-mono text-ink">{{ mailFromFor(domain) }}</span>
                <span class="text-[11px] text-ink/55">
                  A subdomain rejections come back to, and where our SPF record goes so it
                  cannot collide with the one your own mail publishes.
                </span>
              </span>
            </li>
          </ul>
        </section>

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
            :loading="busy"
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

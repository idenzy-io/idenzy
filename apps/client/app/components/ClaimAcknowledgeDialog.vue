<script setup lang="ts">
/**
 * The one question publishing asks: private metadata is about to be in every token, is
 * that meant?
 *
 * It names each mapped key and shows the value a token would actually carry for a sample
 * user, because "reads private metadata" is a category and `"org": "org_7f3a"` is the
 * thing that will be in a header on somebody's laptop. It also says the sentence a
 * reader otherwise supplies for themselves and gets wrong: a token is signed, not
 * encrypted, so the signature says nobody changed these values and nothing at all about
 * who can read them.
 *
 * What the server stores is when this was given, so the dialog says that too: the
 * question a reviewer asks later is not whether a box was ticked but when somebody
 * agreed. One deliberate acknowledgement, at publish, and never per claim.
 */
import { type ClaimMapping, resolveClaim, type SampleUser } from "~/utils/claims";

const props = defineProps<{
  /** The mappings that read private metadata. */
  claims: readonly ClaimMapping[];
  /** The project this publishes to, named because a draft is held per project. */
  projectName: string;
  /** The sample the exposed values are read from, so the exposure is concrete. */
  sample: SampleUser;
  sampleLabel: string;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [];
}>();

const agreed = ref(false);

watch(open, (value) => {
  if (value) agreed.value = false;
});

const exposed = computed(() =>
  props.claims.map((claim) => {
    const value = resolveClaim(claim, props.sample);
    return {
      name: claim.name.trim() || "(unnamed)",
      path: claim.path.trim(),
      value: value === undefined || value === null ? null : JSON.stringify(value),
    };
  }),
);

function confirm() {
  if (!agreed.value || props.busy) return;
  emit("confirm");
}
</script>

<template>
  <v-dialog v-model="open" :persistent="busy" max-width="560">
    <v-card aria-labelledby="claim-ack-title" border flat role="dialog">
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 id="claim-ack-title" class="m-0 flex items-center gap-2 text-sm font-medium text-ink">
            <Icon
              aria-hidden="true"
              class="text-base text-warning"
              name="material-symbols:lock-open-outline"
            />
            Publish private metadata into every token?
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            Publishing to <span class="font-medium text-ink">{{ projectName }}</span>. Private
            metadata is the one place you keep what a browser was never meant to see. An access
            token is read by everything the user's device sends it to: your own servers, and
            anything else that asks for it.
          </p>
        </header>

        <div
          class="flex flex-col gap-2 rounded-(--idenzy-radius-small) border border-warning/40 bg-warning/6 px-3.5 py-3"
        >
          <p class="m-0 flex items-baseline justify-between gap-3 text-[11px] font-medium text-ink">
            <span>
              {{ exposed.length === 1 ? "This key leaves the management API" : "These keys leave the management API" }}
            </span>
            <span class="font-normal text-ink/50">for {{ sampleLabel.toLowerCase() }}</span>
          </p>
          <ul class="m-0 flex list-none flex-col gap-1.5 p-0">
            <li
              v-for="entry in exposed"
              :key="entry.name"
              class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-baseline gap-x-3 text-[11px] leading-4"
            >
              <span class="min-w-0 truncate font-mono text-ink/80">
                metadata_private.{{ entry.path }}
              </span>
              <span v-if="entry.value !== null" class="min-w-0 truncate font-mono"><span class="text-ink/60">"{{ entry.name }}"</span><span class="text-ink/40">: </span><span class="text-ink">{{ entry.value }}</span></span>
              <span v-else class="min-w-0 truncate text-ink/50">
                nothing for this user, so nothing carried
              </span>
            </li>
          </ul>
        </div>

        <p class="m-0 flex items-start gap-2 text-[11px] leading-4 text-ink/60">
          <Icon
            aria-hidden="true"
            class="mt-px flex-none text-sm text-ink/45"
            name="material-symbols:info-outline"
          />
          <span>
            A token is signed, not encrypted. The signature proves nobody altered these
            values; it does not stop anybody holding the token from reading them. Anyone who
            can open a browser's developer tools can read every claim in it.
          </span>
        </p>

        <label class="flex cursor-pointer items-start gap-2 text-xs leading-5 text-ink">
          <v-checkbox-btn v-model="agreed" class="-mt-0.5" color="primary" density="compact" />
          <span>
            I understand that these values will be in every access token
            {{ projectName }} issues, for every user, and readable by anything the token is
            sent to.
          </span>
        </label>

        <footer class="flex flex-wrap items-center justify-between gap-3">
          <p class="m-0 text-[11px] text-ink/50">
            The time of this acknowledgement is stored with the template.
          </p>
          <span class="flex items-center gap-2">
            <v-btn
              :disabled="busy"
              class="text-xs font-medium"
              color="neutral"
              size="small"
              variant="text"
              @click="open = false"
            >
              Keep editing
            </v-btn>
            <v-btn
              :disabled="!agreed"
              :loading="busy"
              class="text-xs font-medium"
              color="warning"
              size="small"
              type="submit"
              variant="flat"
            >
              Publish template
            </v-btn>
          </span>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>

<style scoped>
:deep(.v-selection-control) {
  --v-selection-control-size: 24px;

  flex: none;
  min-height: 0;
}
</style>

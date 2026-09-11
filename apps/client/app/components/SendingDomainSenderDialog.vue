<script setup lang="ts">
/**
 * Moves the From line from one domain to another.
 *
 * It is the one act on this screen that changes what a user sees, and it is deliberately
 * separate from verifying a domain: a customer who has just watched five records turn
 * green must not discover that their sender moved as a side effect of that (see the
 * acceptance checks in notes/email-domains.md).
 *
 * Every domain the project holds is listed, including the ones that cannot send, each
 * with the reason. An option that simply vanished would read as a domain that was never
 * added, and the reader would go looking for it on a screen it is already on.
 *
 * The monthly charge is repeated here because this is the second point of commitment: a
 * domain of your own is dearer than ours under the break-even volume, and the figure at
 * the moment of choosing is the one somebody can act on.
 */
import {
  CUSTOM_DOMAIN_MONTHLY,
  fromAddress,
  isReadyToSend,
  monthlyCost,
  recordProgress,
  type SendingDomain,
  senderLine,
  sendingState,
} from "~/utils/sending-domains";

const props = defineProps<{
  domains: readonly SendingDomain[];
  /** The domain carrying the From line now. */
  current: SendingDomain | null;
  projectName: string;
  /** This project's sends over the last thirty days, for the cost of each option. */
  sends: number;
  busy: boolean;
  /** A failed write, kept beside the choice rather than closing over it. */
  error: string;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [id: string];
}>();

const picked = ref("");
const titleId = useId();
const groupId = useId();

/* Opens on what is in force, so Cancel and a closed dialog are the same outcome. */
watch(open, (value) => {
  if (value) picked.value = props.current?.id ?? "";
});

const choices = computed(() =>
  props.domains.map((domain) => {
    const ready = isReadyToSend(domain);
    const progress = recordProgress(domain);
    return {
      domain,
      ready,
      address: fromAddress(domain.domain),
      cost: monthlyCost(props.sends, !domain.shared),
      /** Why it cannot be picked, in the words the row on the page uses. */
      blocked: ready
        ? ""
        : `${progress.found} of ${progress.required} required records found. It cannot carry mail until they all resolve.`,
      note: domain.shared
        ? "Ours. Reputation shared with every project on it, and no monthly charge."
        : sendingState(domain).detail,
    };
  }),
);

const chosen = computed(() => choices.value.find((choice) => choice.domain.id === picked.value));
const changed = computed(() => picked.value !== "" && picked.value !== props.current?.id);
const ready = computed(() => changed.value && chosen.value?.ready === true);

function money(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * The rest of the cost sentence, built here rather than across template nodes: the
 * compiler trims the whitespace around them, which left every figure with a space before
 * its own full stop.
 */
function costTail(shared: boolean): string {
  const base = " a month at this project's last thirty days";
  return shared
    ? `${base}.`
    : `${base}, including the ${money(CUSTOM_DOMAIN_MONTHLY)} this domain carries whether it sends or not.`;
}

function confirm() {
  if (!ready.value || props.busy) return;
  emit("confirm", picked.value);
}
</script>

<template>
  <v-dialog v-model="open" :persistent="busy" max-width="560" scrollable>
    <v-card :aria-labelledby="titleId" border flat role="dialog">
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 :id="titleId" class="m-0 text-sm font-medium text-ink">Change the sending address</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            One address for every auth mail
            <span class="font-medium text-ink">{{ projectName }}</span> sends. Mail keeps
            sending whichever you pick; what moves is the name your users see on it.
          </p>
        </header>

        <fieldset class="m-0 flex flex-col gap-2 border-0 p-0">
          <legend :id="groupId" class="mb-1 p-0 text-xs font-medium text-ink">
            Send from
          </legend>
          <label
            v-for="choice in choices"
            :key="choice.domain.id"
            :class="[
              picked === choice.domain.id
                ? 'border-primary/50 bg-primary/6'
                : 'border-line bg-ink/4',
              choice.ready ? 'cursor-pointer' : 'cursor-not-allowed opacity-70',
            ]"
            class="flex items-start gap-3 rounded-(--idenzy-radius-small) border px-3 py-2.5 transition-colors duration-150"
          >
            <input
              v-model="picked"
              :aria-describedby="groupId"
              :disabled="!choice.ready"
              :value="choice.domain.id"
              class="mt-0.5 size-3.5 flex-none accent-[rgb(var(--v-theme-primary))]"
              name="sending-domain-choice"
              type="radio"
            />
            <span class="flex min-w-0 flex-1 flex-col gap-1">
              <span class="flex flex-wrap items-center gap-2">
                <span class="font-mono text-xs break-all text-ink">{{ choice.address }}</span>
                <span
                  v-if="choice.domain.id === current?.id"
                  class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55"
                >
                  Sending now
                </span>
              </span>
              <span class="text-[11px] leading-4 text-ink/55">
                {{ choice.blocked || choice.note }}
              </span>
              <span class="text-[11px] leading-4 text-ink/55">
                <span class="font-mono text-ink/75">{{ money(choice.cost) }}</span>
                <span>{{ costTail(choice.domain.shared) }}</span>
              </span>
            </span>
          </label>
        </fieldset>

        <!-- Before and after, so the change is read as an address and not as a setting. -->
        <div
          v-if="changed && chosen?.ready"
          class="flex flex-col gap-2 rounded-(--idenzy-radius-small) bg-ink/4 px-4 py-3 ring-1 ring-ink/6 ring-inset"
        >
          <p class="m-0 flex flex-wrap items-center gap-2 font-mono text-[11px]">
            <span class="text-ink/45 line-through">
              {{ senderLine(projectName, current?.domain ?? "") }}
            </span>
            <Icon
              aria-hidden="true"
              class="text-sm text-ink/40"
              name="material-symbols:arrow-forward"
            />
            <span class="text-ink">{{ senderLine(projectName, chosen.domain.domain) }}</span>
          </p>
          <p class="m-0 text-[11px] leading-4 text-ink/55">
            It applies to the next message this project sends. Anything already handed to the
            provider goes out as it was, and a sender that changes is treated as new by a
            mailbox, so the first mails from it are worth watching.
          </p>
        </div>

        <p v-if="error" class="m-0 text-[11px] leading-4 text-error" role="alert">{{ error }}</p>

        <footer class="flex items-center justify-end gap-2">
          <v-btn
            :disabled="busy"
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
            Use this sender
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>

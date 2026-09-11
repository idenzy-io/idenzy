<script setup lang="ts">
/**
 * Changes the RP ID, and settles what that does to the origins in the same write. A
 * credential is bound to the RP ID it was created under, so every passkey on the project
 * stops answering the moment the id changes, and there is no migration: the owners enrol
 * again. The number is stated because it is the whole cost, and the id is typed in here
 * rather than in the row, so a slip of the keyboard cannot start it.
 *
 * WebAuthn allows an origin only on the RP ID's own domain, so an origin on the old
 * domain cannot follow the id. Those are dropped here, listed, and when none would
 * remain the dialog asks for the first origin on the new domain, because a party with
 * no origin refuses every ceremony. Done as one record: sent as two writes, each would
 * be refused by the other's rule, and nothing could ever move.
 */
import {
  isRpId,
  normaliseOrigin,
  ORIGIN_ISSUE_LABELS,
  RP_ISSUE_LABELS,
  validateOrigin,
} from "~/utils/passkeys";

const props = defineProps<{
  from: string;
  enrolled: number;
  origins: readonly string[];
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  /** The new id, and the origins the party keeps under it, first one included. */
  confirm: [rpId: string, origins: string[]];
}>();

const rpId = ref("");
const firstOrigin = ref("");
const acknowledged = ref(false);
/* Focused once the dialog has finished entering; `autofocus` loses to the overlay's own focus. */
const rpIdField = useTemplateRef<{ focus: () => void }>("rpIdField");

watch(open, (value) => {
  if (!value) return;
  rpId.value = "";
  firstOrigin.value = "";
  acknowledged.value = false;
});

const to = computed(() => rpId.value.trim().toLowerCase());

const rpIdIssue = computed(() => {
  if (to.value === "") return "";
  if (!isRpId(to.value)) return RP_ISSUE_LABELS.rp_id_invalid;
  if (to.value === props.from) return "That is the domain the project uses now.";
  return "";
});
const rpIdReady = computed(() => to.value !== "" && rpIdIssue.value === "");

const kept = computed(() =>
  rpIdReady.value
    ? props.origins.filter((origin) => validateOrigin(origin, to.value) === null)
    : [],
);
const dropped = computed(() => props.origins.filter((origin) => !kept.value.includes(origin)));
const needsOrigin = computed(() => rpIdReady.value && kept.value.length === 0);

const firstOriginIssue = computed(() => {
  const text = firstOrigin.value.trim();
  if (text === "") return "";
  const issue = validateOrigin(text, to.value);
  return issue === null ? "" : ORIGIN_ISSUE_LABELS[issue];
});

const ready = computed(() => {
  if (!rpIdReady.value) return false;
  if (props.enrolled > 0 && !acknowledged.value) return false;
  if (!needsOrigin.value) return true;
  return firstOrigin.value.trim() !== "" && firstOriginIssue.value === "";
});

function confirm() {
  if (!ready.value) return;
  const origins = needsOrigin.value ? [normaliseOrigin(firstOrigin.value)] : kept.value;
  emit("confirm", to.value, origins);
  open.value = false;
}

const count = computed(() => props.enrolled.toLocaleString("en"));
</script>

<template>
  <v-dialog v-model="open" max-width="460" @after-enter="rpIdField?.focus()">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Change the passkey domain</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            The registrable domain the passkeys are bound to. It is
            <span class="font-mono text-ink/80">{{ from }}</span> now.
          </p>
        </header>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-ink" for="rp-id-next">New passkey domain</label>
          <v-text-field
            id="rp-id-next"
            ref="rpIdField"
            v-model="rpId"
            :error="rpIdIssue !== ''"
            autocomplete="off"
            class="font-mono"
            hide-details
            name="idenzy-passkey-domain"
            placeholder="example.org"
            variant="filled"
          />
          <p class="m-0 text-[11px]" :class="rpIdIssue ? 'text-error' : 'text-ink/50'">
            {{ rpIdIssue || "A domain with no scheme, port or path. Every application URL has to sit on it." }}
          </p>
        </div>

        <p v-if="enrolled > 0" class="m-0 text-xs leading-5 text-ink/80">
          A passkey is bound to the RP ID it was created under. The
          <span class="font-mono tabular-nums">{{ count }}</span>
          {{ enrolled === 1 ? "passkey" : "passkeys" }} on this project will stop answering
          as soon as the id changes, and nothing brings them back: their owners sign in
          another way and enrol again. Do this before people have enrolled, or not at all.
        </p>

        <section v-if="rpIdReady && dropped.length > 0" class="flex flex-col gap-2">
          <p class="m-0 text-xs leading-5 text-ink/80">
            An origin has to sit on the RP ID's domain, so
            {{ dropped.length === 1 ? "this one cannot follow it" : "these cannot follow it" }}
            and {{ dropped.length === 1 ? "comes" : "come" }} off the list:
          </p>
          <ul class="m-0 flex list-none flex-col gap-1 p-0">
            <li
              v-for="origin in dropped"
              :key="origin"
              class="flex items-center gap-2 rounded-md bg-ink/4 ring-1 ring-ink/6 ring-inset px-2.5 py-1.5 font-mono text-xs text-ink/50 line-through"
            >
              <Icon aria-hidden="true" class="flex-none text-sm" name="material-symbols:language" />
              <span class="truncate">{{ origin }}</span>
            </li>
          </ul>
          <p v-if="kept.length > 0" class="m-0 text-[11px] text-ink/50">
            {{ kept.length === 1 ? "One origin stays" : `${kept.length} origins stay` }}, so ceremonies keep running from there.
          </p>
        </section>

        <div v-if="needsOrigin" class="flex flex-col gap-1">
          <label class="text-xs font-medium text-ink" for="rp-move-origin">First application URL on {{ to }}</label>
          <v-text-field
            id="rp-move-origin"
            v-model="firstOrigin"
            :error="firstOriginIssue !== ''"
            :placeholder="`https://app.${to}`"
            autocomplete="off"
            class="font-mono"
            hide-details
            name="idenzy-passkey-url"
            variant="filled"
          />
          <p class="m-0 text-[11px]" :class="firstOriginIssue ? 'text-error' : 'text-ink/50'">
            {{ firstOriginIssue || "A project with no URL refuses every ceremony, so one goes in with the domain." }}
          </p>
        </div>

        <label v-if="enrolled > 0" class="flex cursor-pointer items-start gap-2 text-xs text-ink">
          <v-checkbox-btn v-model="acknowledged" class="-mt-1.5 -ml-1.5" color="error" density="compact" />
          <span class="pt-px">I understand every passkey on this project stops working.</span>
        </label>

        <footer class="flex items-center justify-end gap-2">
          <v-btn class="text-xs font-medium" color="neutral" size="small" variant="text" @click="open = false">
            Keep {{ from }}
          </v-btn>
          <v-btn
            :disabled="!ready"
            class="text-xs font-medium"
            :color="enrolled > 0 ? 'error' : 'primary'"
            size="small"
            type="submit"
            variant="flat"
          >
            Change domain
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>

<style scoped>
:deep(.v-selection-control) {
  --v-selection-control-size: 28px;

  flex: none;
  min-height: 0;
}

:deep(.v-selection-control__input > .v-icon) {
  font-size: 1.125rem;
}
</style>

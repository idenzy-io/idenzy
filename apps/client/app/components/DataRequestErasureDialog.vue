<script setup lang="ts">
/**
 * The erasure, reviewed for the one account it acts on before anything happens. Logging a
 * request never erases; this is the separate destructive confirmation the note asks for,
 * and it names what this account actually holds rather than what an account might.
 *
 * It runs the users screen's own erasure, so a request answered here and an account
 * deleted there cannot come to differ: personal fields cleared in place, sessions revoked,
 * the row kept as a tombstone. The request stays open afterwards, because the person still
 * has to be told.
 */
import type { Refusal } from "~/stores/data-requests";
import { type DataSubjectRequest, ERASURE_KEEPS } from "~/utils/data-requests";
import { METHOD_LABELS, nameOf, type ProjectUser } from "~/utils/users";

const props = defineProps<{
  request: DataSubjectRequest;
  user: ProjectUser;
  /** Runs it, and resolves to null or the sentence saying why it was refused. */
  submit: () => Promise<Refusal>;
}>();

const open = defineModel<boolean>({ required: true });

const titleId = `${useId()}-title`;

const acknowledged = ref(false);
const busy = ref(false);
const failure = ref("");

const name = computed(() => nameOf(props.user));
const already = computed(() => props.user.deletedAt !== null);

function sentence(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** What this account holds that the erasure clears, named rather than assumed. */
const fields = computed(() => {
  const parts: string[] = [];
  if (props.user.displayName) parts.push("name");
  if (props.user.email) parts.push("email address");
  if (props.user.phone) parts.push("phone number");
  const keys = Object.keys(props.user.metadataPublic).length;
  if (keys > 0) parts.push(`${keys} metadata ${keys === 1 ? "key" : "keys"}`);
  const text = sentence(parts);
  return text === "" ? "" : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
});

const methods = computed(() => sentence(props.user.methods.map((method) => METHOD_LABELS[method])));

const action = computed(() =>
  name.value.length > 24 ? "Erase their data" : `Erase ${name.value}'s data`,
);

async function confirm() {
  failure.value = "";
  if (!acknowledged.value || busy.value) return;
  busy.value = true;
  try {
    const refusal = await props.submit();
    if (refusal === null) open.value = false;
    else failure.value = refusal;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <v-dialog v-model="open" :aria-labelledby="titleId" :persistent="busy" max-width="520" scrollable>
    <v-card border flat>
      <div class="flex max-h-[88vh] flex-col">
        <header class="flex flex-none flex-col gap-1 border-b border-line px-5 py-4">
          <h2 :id="titleId" class="m-0 truncate text-sm font-medium text-ink">
            Erase {{ name }}'s data
          </h2>
          <p class="m-0 text-xs text-ink/60">
            <span class="font-mono text-[11px] text-ink/70">{{ user.id }}</span> · An erasure
            cannot be undone.
          </p>
        </header>

        <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
          <p v-if="already" class="m-0 text-xs leading-5 text-ink/75">
            This account is already a tombstone. Running it records the erasure against this
            request, and clears the identity they gave when they asked.
          </p>

          <ul v-else class="m-0 flex list-none flex-col gap-2.5 p-0 text-xs leading-5 text-ink/80">
            <li v-if="fields" class="flex gap-2">
              <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm text-ink/45" name="material-symbols:person-off-outline" />
              <span>{{ fields }} {{ fields.includes(" and ") ? "are" : "is" }} cleared.</span>
            </li>
            <li v-if="methods" class="flex gap-2">
              <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm text-ink/45" name="material-symbols:fingerprint" />
              <span>
                {{ user.methods.length === 1 ? "Their one way to sign in goes" : `All ${user.methods.length} ways to sign in go` }}
                with it: {{ methods }}.
                <template v-if="user.mfaEnabled">Their authenticator and recovery codes too.</template>
              </span>
            </li>
            <li class="flex gap-2">
              <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm text-ink/45" name="material-symbols:logout" />
              <span>
                <template v-if="user.activeSessions > 0">
                  <span class="font-mono tabular-nums">{{ user.activeSessions }}</span>
                  open {{ user.activeSessions === 1 ? "session is" : "sessions are" }} revoked.
                </template>
                <template v-else>No session is open, and none can be started afterwards.</template>
                A token already issued stops working at its next rotation.
              </span>
            </li>
            <li class="flex gap-2">
              <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm text-ink/45" name="material-symbols:history" />
              <span>
                The request stays open until you record the answer. It keeps the account id as
                proof the erasure ran, and drops the identity they gave when they asked.
              </span>
            </li>
          </ul>

          <div class="flex flex-col gap-2 rounded-(--idenzy-radius-small) bg-ink/4 px-3 py-2.5 ring-1 ring-ink/6 ring-inset">
            <span class="text-[11px] font-medium text-ink/70">What survives it</span>
            <ul class="m-0 flex list-none flex-col gap-1 p-0">
              <li v-for="kept in ERASURE_KEEPS" :key="kept.what" class="text-[11px] leading-4 text-ink/65">
                {{ kept.what }}
              </li>
            </ul>
          </div>

          <label class="flex cursor-pointer items-start gap-2 text-xs text-ink">
            <v-checkbox-btn
              v-model="acknowledged"
              :disabled="busy"
              class="-mt-1.5 -ml-1.5"
              color="error"
              density="compact"
            />
            <span class="pt-px">
              This is {{ name }}'s account, and nothing requires keeping what it holds.
            </span>
          </label>

          <p v-if="failure" class="m-0 text-[11px] leading-4 text-error" role="alert">
            {{ failure }}
          </p>
        </div>

        <footer class="flex flex-none items-center justify-end gap-2 border-t border-line px-5 py-3">
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
            :disabled="!acknowledged"
            :loading="busy"
            class="text-xs font-medium"
            color="error"
            prepend-icon="material-symbols:delete-outline"
            size="small"
            variant="flat"
            @click="confirm"
          >
            {{ action }}
          </v-btn>
        </footer>
      </div>
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

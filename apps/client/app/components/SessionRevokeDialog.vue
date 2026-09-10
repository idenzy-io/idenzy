<script setup lang="ts">
/**
 * Confirms ending one or more sessions, and says the one thing an operator revoking a
 * session after an incident has to know before they close the tab.
 *
 * A revocation stops the refresh token immediately: the session cannot rotate again from
 * the moment this returns. It does not reach the access token already in the device's
 * hands, which was minted to be verified offline against JWKS and stays verifiable for
 * the rest of its lifetime (PROJECT.md 4.2). A backend holding a `RevocationCache` closes
 * that window to one poll; one that does not waits out the token. Saying so here is the
 * difference between an operator who knows they have a minute to wait and one who thinks
 * the button did not work.
 *
 * Our own API is not in that window: `SessionGuard` reads the session row, so revocation
 * is immediate there (ADR-0009).
 */
import { deviceLabel, type SessionRow } from "~/utils/sessions";
import { nameOf } from "~/utils/users";

const props = defineProps<{
  sessions: readonly SessionRow[];
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [];
}>();

const single = computed(() => (props.sessions.length === 1 ? props.sessions[0] : undefined));

const subject = computed(() => {
  const one = single.value;
  if (one) return `${deviceLabel(one)} · ${nameOf(one.user)}`;
  return `${props.sessions.length} sessions`;
});

/** How many accounts are affected, which is the figure that makes a bulk revoke real. */
const accounts = computed(() => new Set(props.sessions.map((session) => session.userId)).size);

function confirm() {
  emit("confirm");
  open.value = false;
}
</script>

<template>
  <v-dialog v-model="open" max-width="480">
    <v-card border flat>
      <div class="flex flex-col gap-5 p-5">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">
            Revoke {{ single ? "this session" : `${sessions.length} sessions` }}
          </h2>
          <p class="m-0 truncate text-xs text-ink/60">{{ subject }}</p>
        </header>

        <p v-if="!single" class="m-0 text-xs text-ink/70">
          Across
          <span class="font-mono tabular-nums">{{ accounts }}</span>
          {{ accounts === 1 ? "account" : "accounts" }}. Each device is signed out and has to
          sign in again. Nothing else about the accounts changes.
        </p>
        <p v-else class="m-0 text-xs text-ink/70">
          The device is signed out and has to sign in again. Nothing else about the account
          changes.
        </p>

        <!-- The window the button cannot close, said plainly rather than left to be found. -->
        <div class="flex gap-2.5 rounded-(--idenzy-radius-small) border border-line bg-ink/3 p-3">
          <Icon
            aria-hidden="true"
            class="mt-px flex-none text-sm text-ink/50"
            name="material-symbols:info-outline"
          />
          <p class="m-0 text-[11px] leading-relaxed text-ink/60">
            The refresh token stops at once, so the session cannot renew itself. An access
            token already issued keeps verifying offline until it expires, which is up to one
            access-token lifetime. A backend polling the revocation set sees this within one
            poll; one that is not waits the token out. Our own API refuses the session
            immediately.
          </p>
        </div>

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
            class="text-xs font-medium"
            color="error"
            prepend-icon="material-symbols:logout"
            size="small"
            variant="flat"
            @click="confirm"
          >
            Revoke
          </v-btn>
        </footer>
      </div>
    </v-card>
  </v-dialog>
</template>

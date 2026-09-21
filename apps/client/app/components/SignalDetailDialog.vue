<script setup lang="ts">
/**
 * One signal, read in full: what the detector saw, what else it could be, who it names,
 * what has already been decided, and the three things that can be done about it.
 *
 * The evidence and the uncertainty are set at the same size and in that order, because the
 * whole screen argues one point: a signal is evidence and not a verdict. A password in a
 * public corpus is a password somebody else also chose; two sign-ins far apart in space
 * and close in time are a laptop and a phone on a VPN far more often than a theft. A panel
 * that led with the finding and put the innocent explanation in small print underneath
 * would be making the opposite argument in the layout.
 *
 * Acknowledge is neutral and flat, Dismiss is text, and signing out is the only
 * destructive one and sits apart from both (notes/security.md). Nothing here suspends an
 * account: a suspension is a decision about a person and it belongs on the screen that
 * lists people, not on a row that says a password is also somebody else's.
 */

import type { BadgeTone } from "~/components/StatusBadge.vue";
import {
  DISMISS_REASON_LABELS,
  KIND_LABELS,
  KIND_NOTES,
  kindOf,
  SEVERITY_LABELS,
  SEVERITY_NOTES,
  type SecuritySignal,
  type Severity,
  SIGNAL_STATE_LABELS,
  type SignalState,
} from "~/utils/security";
import { formatDateTime, relativeTime } from "~/utils/time";
import { nameOf, type ProjectUser } from "~/utils/users";

const props = defineProps<{
  signal: SecuritySignal;
  /** Null where the evidence names an address rather than an account. */
  user: ProjectUser | null;
  severity: Severity;
  now: Date;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  acknowledge: [];
  dismiss: [];
  signOut: [];
}>();

const titleId = `${useId()}-title`;

const SEVERITY_TONES: Record<Severity, BadgeTone> = {
  act: "error",
  review: "warning",
  record: "neutral",
};

const STATE_TONES: Record<SignalState, BadgeTone> = {
  open: "neutral",
  acknowledged: "success",
  dismissed: "neutral",
};

const kind = computed(() => kindOf(props.signal));
</script>

<template>
  <!-- `width` as well as `max-width`: a cap alone lets the dialog size itself to its
       shortest section and rewrap around the others. -->
  <v-dialog v-model="open" :aria-labelledby="titleId" max-width="640" scrollable width="100%">
    <v-card border flat>
      <div class="flex max-h-[86vh] flex-col">
        <header
          class="flex flex-none flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 py-4"
        >
          <div class="flex min-w-0 flex-col gap-1.5">
            <h2 :id="titleId" class="m-0 text-sm font-medium text-ink">
              {{ KIND_LABELS[kind] }}
            </h2>
            <div class="flex flex-wrap items-center gap-2">
              <StatusBadge :label="SEVERITY_LABELS[severity]" :tone="SEVERITY_TONES[severity]" />
              <StatusBadge
                :label="SIGNAL_STATE_LABELS[signal.state]"
                :tone="STATE_TONES[signal.state]"
              />
              <v-tooltip :text="formatDateTime(signal.seenAt)" location="top">
                <template #activator="{ props: tip }">
                  <span v-bind="tip" class="text-[11px] text-ink/50">
                    Seen {{ relativeTime(signal.seenAt, now) }}
                  </span>
                </template>
              </v-tooltip>
            </div>
          </div>
          <span class="flex-none font-mono text-[11px] text-ink/40">{{ signal.id }}</span>
        </header>

        <div class="flex min-h-0 flex-1 flex-col divide-y divide-line overflow-y-auto border-t border-line">
          <div class="flex flex-col gap-1.5 px-5 py-4">
            <span class="text-xs text-ink/45">What the detector saw</span>
            <EvidenceLine :evidence="signal.evidence" />
          </div>

          <!-- The uncertainty, at the same size as the evidence. -->
          <div class="flex flex-col gap-1.5 px-5 py-4">
            <span class="text-xs text-ink/45">What else it could be</span>
            <p class="m-0 text-xs leading-5 text-ink/65">{{ KIND_NOTES[kind] }}</p>
            <p class="m-0 text-[11px] leading-4 text-ink/45">{{ SEVERITY_NOTES[severity] }}</p>
          </div>

          <div class="flex flex-col gap-2 px-5 py-4">
            <span class="text-xs text-ink/45">Related</span>
            <div v-if="user" class="flex flex-wrap items-center gap-x-4 gap-y-2">
              <NuxtLink
                :to="`/users/${user.id}`"
                class="inline-flex items-center gap-1 text-xs font-medium text-ink no-underline hover:underline"
              >
                <Icon aria-hidden="true" class="text-sm" name="material-symbols:person-outline" />
                {{ nameOf(user) }}
              </NuxtLink>
              <NuxtLink
                :to="`/users/${user.id}`"
                class="inline-flex items-center gap-1 text-xs font-medium text-ink/70 no-underline hover:text-ink hover:underline"
              >
                <Icon aria-hidden="true" class="text-sm" name="material-symbols:devices-outline" />
                {{ user.activeSessions }}
                {{ user.activeSessions === 1 ? "session" : "sessions" }}
              </NuxtLink>
              <NuxtLink
                class="inline-flex items-center gap-1 text-xs font-medium text-ink/70 no-underline hover:text-ink hover:underline"
                to="/audit"
              >
                <Icon aria-hidden="true" class="text-sm" name="material-symbols:history" />
                Audit log
              </NuxtLink>
            </div>
            <p v-else class="m-0 text-xs leading-5 text-ink/55">
              This signal names an address rather than an account: a list being tried against
              many addresses is about the address doing the trying, and there is no one person
              to open.
            </p>
          </div>

          <div class="flex flex-col gap-1.5 px-5 py-4">
            <span class="text-xs text-ink/45">Decision</span>
            <p v-if="signal.state === 'open'" class="m-0 text-xs leading-5 text-ink/55">
              Nobody has decided about this one yet.
            </p>
            <p v-else class="m-0 text-xs leading-5 text-ink/65">
              <span class="font-medium text-ink">{{ SIGNAL_STATE_LABELS[signal.state] }}</span>
              <template v-if="signal.reason">
                · {{ DISMISS_REASON_LABELS[signal.reason] }}
              </template>
              <template v-if="signal.decidedBy"> · by {{ signal.decidedBy }}</template>
              <template v-if="signal.decidedAt">
                · {{ relativeTime(signal.decidedAt, now) }}
              </template>
            </p>
            <p class="m-0 text-[11px] leading-4 text-ink/45">
              Every decision here is written to the audit log, and dismissing one says nothing
              about the account being safe: it says somebody looked.
            </p>
          </div>
        </div>

        <footer
          class="flex flex-none flex-wrap items-center gap-2 border-t border-line px-5 py-3"
        >
          <v-btn
            :disabled="signal.state === 'acknowledged'"
            :loading="busy"
            class="text-xs font-medium"
            color="neutral"
            prepend-icon="material-symbols:check"
            size="small"
            variant="flat"
            @click="emit('acknowledge')"
          >
            Acknowledge
          </v-btn>
          <v-btn
            :disabled="signal.state === 'dismissed'"
            class="text-xs font-medium"
            color="neutral"
            size="small"
            variant="text"
            @click="emit('dismiss')"
          >
            Dismiss
          </v-btn>
          <span class="ml-auto flex items-center gap-2">
            <v-btn
              v-if="user"
              class="text-xs font-medium"
              color="error"
              prepend-icon="material-symbols:logout"
              size="small"
              variant="text"
              @click="emit('signOut')"
            >
              Sign out everywhere
            </v-btn>
            <v-btn
              class="text-xs font-medium"
              color="neutral"
              size="small"
              variant="text"
              @click="open = false"
            >
              Close
            </v-btn>
          </span>
        </footer>
      </div>
    </v-card>
  </v-dialog>
</template>

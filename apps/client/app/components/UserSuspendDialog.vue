<script setup lang="ts">
/**
 * Confirms a suspension and asks how long it lasts. The one thing it has to say is the
 * rule the server keeps: a ban is read at the next token rotation, so a session that is
 * open now keeps working for up to one access-token lifetime (refresh-service.ts). An
 * operator who needs the account off the air this minute signs it out everywhere as
 * well, and the dialog offers that beside the confirm rather than making them find it.
 */
import { DURATIONS } from "~/utils/time";
import { INDEFINITE, nameOf, type ProjectUser } from "~/utils/users";
import type { SegmentedOption } from "./SegmentedControl.vue";

const props = defineProps<{
  users: readonly ProjectUser[];
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [until: string, signOut: boolean];
}>();

const DURATION_OPTIONS: readonly SegmentedOption[] = [
  { value: "1h", label: "1 hour" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "indefinite", label: "Until lifted" },
];

const DURATION_MS: Record<string, number> = {
  "1h": DURATIONS.HOUR,
  "24h": DURATIONS.DAY,
  "7d": DURATIONS.WEEK,
  "30d": 30 * DURATIONS.DAY,
};

const duration = ref("7d");
const signOut = ref(true);

watch(open, (value) => {
  if (!value) return;
  duration.value = "7d";
  signOut.value = true;
});

const subject = computed(() => {
  const [first] = props.users;
  if (props.users.length === 1 && first) return nameOf(first);
  return `${props.users.length} users`;
});

const sessions = computed(() => props.users.reduce((sum, user) => sum + user.activeSessions, 0));

function confirm() {
  const ms = DURATION_MS[duration.value];
  const until = ms === undefined ? INDEFINITE : new Date(Date.now() + ms).toISOString();
  emit("confirm", until, signOut.value);
  open.value = false;
}
</script>

<template>
  <v-dialog v-model="open" max-width="460">
    <v-card border flat>
      <div class="flex flex-col gap-5 p-5">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Suspend {{ subject }}</h2>
          <p class="m-0 text-xs text-ink/60">
            A suspended account cannot sign in and is refused a new token. Nothing is
            deleted, and the suspension can be lifted at any time.
          </p>
        </header>

        <UserTargetList v-if="users.length > 1" :users="users" />

        <div class="flex flex-col gap-1.5">
          <h3 class="m-0 text-xs font-medium text-ink/70">For how long</h3>
          <SegmentedControl v-model="duration" :options="DURATION_OPTIONS" label="Duration" />
        </div>

        <label class="flex cursor-pointer items-start gap-2 text-xs text-ink">
          <v-checkbox-btn v-model="signOut" class="-mt-1.5 -ml-1.5" color="primary" density="compact" />
          <span class="flex flex-col gap-0.5 pt-px">
            Also sign out everywhere
            <span v-if="sessions > 0" class="text-[11px] text-ink/50">
              Ends
              <span class="font-mono tabular-nums">{{ sessions }}</span>
              open {{ sessions === 1 ? "session" : "sessions" }} now. Without this, a session
              that is already open keeps working until its next token rotation, up to one
              access-token lifetime.
            </span>
            <span v-else class="text-[11px] text-ink/50">
              No sessions are open, so there is nothing to end. Kept on so a sign-in
              that lands in the meantime is caught.
            </span>
          </span>
        </label>

        <footer class="flex items-center justify-end gap-2">
          <v-btn class="text-xs font-medium" color="neutral" size="small" variant="text" @click="open = false">
            Cancel
          </v-btn>
          <v-btn
            class="text-xs font-medium"
            color="warning"
            prepend-icon="material-symbols:block"
            size="small"
            variant="flat"
            @click="confirm"
          >
            Suspend
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

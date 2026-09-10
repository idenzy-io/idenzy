<script setup lang="ts">
/**
 * Takes somebody off the team, and says the two things that are easy to assume wrongly.
 *
 * Their access ends on their next request rather than at the moment this lands, because a
 * dashboard session is a session like any other and it is revoked the same way. And what
 * they did stays: the audit trail names them for as long as it is kept, which is what
 * makes removing somebody a safe act rather than a destructive one.
 *
 * Removing yourself is leaving, and the dialog says so in the customer's own words rather
 * than making somebody read "remove Hasan Musluoglu" about themselves.
 */
import type { Member } from "~/utils/members";
import { roleInfo } from "~/utils/members";

const props = defineProps<{
  member: Member | null;
  /** Whether the person being removed is the one reading the page. */
  self: boolean;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [];
}>();

function confirm() {
  if (props.busy) return;
  emit("confirm");
}
</script>

<template>
  <v-dialog v-model="open" max-width="460">
    <v-card v-if="member" border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">
            {{ self ? "Leave this project" : "Remove from the team" }}
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            <template v-if="self">
              You lose access to this project. Somebody with the team permission would have
              to invite you back.
            </template>
            <template v-else>
              <span class="font-medium text-ink">{{ member.name }}</span> loses access as
              {{ roleInfo(member.role).label.toLowerCase() }}. Inviting them again is one
              act, and they keep nothing in the meantime.
            </template>
          </p>
        </header>

        <ul class="m-0 flex list-none flex-col gap-2 p-0">
          <li class="flex items-start gap-2 text-[11px] leading-4 text-ink/60">
            <Icon
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm text-ink/40"
              name="material-symbols:logout"
            />
            <span>
              Their dashboard session ends on its next request rather than this instant. It
              is revoked the way any session is.
            </span>
          </li>
          <li class="flex items-start gap-2 text-[11px] leading-4 text-ink/60">
            <Icon
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm text-ink/40"
              name="material-symbols:history"
            />
            <span>
              What they did stays in the audit log, named, for as long as it is kept. That
              is what makes this a safe thing to do rather than a destructive one.
            </span>
          </li>
          <li class="flex items-start gap-2 text-[11px] leading-4 text-ink/60">
            <Icon
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm text-ink/40"
              name="material-symbols:key-outline"
            />
            <span>
              Any API key they created keeps working. A key belongs to the project rather
              than to a person, so revoke it separately if it was theirs alone.
            </span>
          </li>
        </ul>

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
            :loading="busy"
            class="text-xs font-medium"
            color="error"
            size="small"
            type="submit"
            variant="flat"
          >
            {{ self ? "Leave the project" : "Remove them" }}
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>

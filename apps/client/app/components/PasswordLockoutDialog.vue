<script setup lang="ts">
/**
 * Confirms turning account lockout on, which is the setting on the passwords screen that
 * can be used against the people it protects.
 *
 * A lockout is a denial-of-service anybody can aim: an attacker who knows an address can
 * fail against it deliberately until the owner is locked out, and the owner then has to
 * find a mail we sent. That is a real trade rather than a reason to refuse the setting,
 * so the dialog states both halves and names the number it is turning on.
 *
 * Turning it off needs no dialog: nothing is locked out by removing a lock.
 */
defineProps<{
  project: string;
  attempts: number;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{ confirm: [] }>();
</script>

<template>
  <v-dialog v-model="open" max-width="520">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="emit('confirm')">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Turn on account lockout</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            On <span class="font-medium text-ink">{{ project }}</span
            >. After
            <span class="font-mono text-ink">{{ attempts }}</span> consecutive failures an
            account stops accepting its password until its owner unlocks it from a link sent
            to their address.
          </p>
        </header>

        <SamplePanel
          meta="Both directions"
          note="What a lockout does, and what it can be made to do."
          title="Before you turn it on"
        >
          <SampleLine icon="material-symbols:shield-outline">
            It ends an online guessing run against one account, on top of the rate limiting
            that is always on.
          </SampleLine>
          <SampleLine class="mt-1" icon="material-symbols:warning-outline" tone="warning">
            Anybody who knows an address can fail against it on purpose and lock that person
            out. The rate limiter refuses a guesser either way; a lockout is what turns those
            refusals into the owner's problem.
          </SampleLine>
          <SampleLine class="mt-1" icon="material-symbols:mark-email-unread-outline" tone="muted">
            The unlock mail is the way back, so it depends on delivery working for that
            address.
          </SampleLine>
        </SamplePanel>

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
            color="primary"
            size="small"
            type="submit"
            variant="flat"
          >
            Turn on lockout
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>

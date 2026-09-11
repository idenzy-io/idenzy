<script setup lang="ts">
/**
 * Hands the project on. One act rather than two: the person chosen becomes the owner and
 * the current one becomes an admin in the same change, so the project is never without an
 * owner and never has two.
 *
 * It asks for the name to be typed, which is the panel's usual guard for something the
 * actor cannot undo alone. After this, taking it back needs the new owner to agree, and
 * that is the whole point of the seat: it is the one that can always undo everything
 * else, so it must not move by a misclick.
 */
import { type Member, roleInfo } from "~/utils/members";

const props = defineProps<{
  /** Everyone who could take it: the team, minus the owner. */
  candidates: readonly Member[];
  owner: Member | null;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [toId: string];
}>();

const chosen = ref<string | null>(null);
const typed = ref("");

watch(open, (value) => {
  if (!value) return;
  chosen.value = null;
  typed.value = "";
});

const target = computed(
  () => props.candidates.find((member) => member.id === chosen.value) ?? null,
);

const confirmed = computed(() => target.value !== null && typed.value.trim() === target.value.name);

function confirm() {
  const to = target.value;
  if (!confirmed.value || to === null || props.busy) return;
  emit("confirm", to.id);
}
</script>

<template>
  <v-dialog v-model="open" max-width="480">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Transfer the project</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            One act. They become the owner and you become an admin in the same change, so
            the project is never without one and never has two.
          </p>
        </header>

        <div v-if="candidates.length === 0" class="text-xs leading-5 text-ink/60">
          There is nobody to hand it to. Invite somebody and let them accept first.
        </div>

        <div v-else class="flex flex-col gap-2">
          <span class="text-xs font-medium text-ink">Who takes it</span>
          <button
            v-for="member in candidates"
            :key="member.id"
            :class="
              chosen === member.id
                ? 'border-primary/50 bg-primary/8'
                : 'border-line bg-ink/4 hover:border-ink/20'
            "
            class="flex cursor-pointer items-center gap-2.5 rounded-(--idenzy-radius-small) border px-3 py-2 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            type="button"
            @click="chosen = member.id"
          >
            <Icon
              :name="roleInfo(member.role).icon"
              aria-hidden="true"
              class="flex-none text-base text-ink/60"
            />
            <span class="flex min-w-0 flex-col">
              <span class="truncate text-xs font-medium text-ink">{{ member.name }}</span>
              <span class="truncate font-mono text-[11px] text-ink/50">{{ member.email }}</span>
            </span>
          </button>
        </div>

        <div v-if="target" class="flex flex-col gap-1">
          <label class="text-xs font-medium text-ink" for="transfer-confirm">
            Type {{ target.name }} to confirm
          </label>
          <v-text-field
            id="transfer-confirm"
            v-model="typed"
            autocomplete="off"
            hide-details
            :placeholder="target.name"
            variant="filled"
          />
          <p class="m-0 text-[11px] leading-4 text-ink/50">
            You keep admin, so you lose only the two things the owner alone can do: handing
            the project on, and deleting it. Taking it back needs
            {{ target.name }} to agree.
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
            Keep it
          </v-btn>
          <v-btn
            :disabled="!confirmed"
            :loading="busy"
            class="text-xs font-medium"
            color="error"
            size="small"
            type="submit"
            variant="flat"
          >
            Transfer the project
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>

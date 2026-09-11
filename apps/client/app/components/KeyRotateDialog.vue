<script setup lang="ts">
/**
 * Starts a rotation on one key: the only way a rotation begins (notes/keys.md).
 *
 * The dialog makes the replacement and nothing else. The old key keeps working, which is
 * what lets the swap happen without downtime, and it goes only when somebody reviews it and
 * revokes it later from the card this leaves on the page. The four steps are stated here once
 * so the reader knows the replacement is the beginning of the job and not the end of it.
 *
 * A compromised key must not take this path, because deploy first and revoke after is exactly
 * wrong for it. The dialog says so and hands over to the urgent revocation.
 */
import { keyName, maskedKey, observationWords, type ProjectApiKey } from "~/utils/keys";

const props = defineProps<{
  keyRow: ProjectApiKey;
  projectName: string;
  busy: boolean;
  error: string;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [];
  compromised: [];
}>();

const now = useNow({ interval: 30_000 });
const titleId = `${useId()}-title`;

const STEPS = [
  "Create the replacement. Its value is shown once, like any key's.",
  "Deploy it everywhere the old key is set, jobs that run rarely included.",
  "Watch for evidence: the replacement observed, the old key not observed since.",
  "Review the old key's consumers and revoke it. Until then both keys work.",
];

const observed = computed(() => observationWords(props.keyRow, now.value));
</script>

<template>
  <v-dialog v-model="open" :aria-labelledby="titleId" max-width="500">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="emit('confirm')">
        <header class="flex flex-col gap-1">
          <h2 :id="titleId" class="m-0 text-base font-medium text-ink">
            Rotate {{ keyName(keyRow) }}
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            The old key keeps working for
            <span class="font-medium text-ink">{{ projectName }}</span> until you revoke it, so
            nothing is interrupted.
          </p>
        </header>

        <div
          class="flex flex-col gap-0.5 rounded-(--idenzy-radius-small) bg-ink/4 p-3 ring-1 ring-ink/6 ring-inset"
        >
          <span class="text-[11px] leading-4 text-ink/50">Old key</span>
          <span class="truncate font-mono text-xs text-ink">{{ maskedKey(keyRow) }}</span>
          <span class="text-[11px] leading-4 text-ink/50">{{ observed }}</span>
        </div>

        <ol class="m-0 flex list-none flex-col gap-2 p-0">
          <li v-for="(step, index) in STEPS" :key="step" class="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              class="mt-0.5 flex size-5 flex-none items-center justify-center rounded-full bg-ink/4 font-mono text-[10px] leading-none text-ink/70 ring-1 ring-ink/6 ring-inset"
            >
              {{ index + 1 }}
            </span>
            <span class="text-xs leading-5 text-ink/75">{{ step }}</span>
          </li>
        </ol>

        <div class="flex flex-col gap-1.5 border-t border-line pt-4">
          <p class="m-0 flex items-start gap-2 text-xs leading-5 text-ink/70">
            <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm text-error" name="material-symbols:bolt" />
            <span>
              Believe this key is compromised? Do not rotate it. Revoke it now and deploy a new
              key after: every minute it stays live is a minute somebody else can use it.
            </span>
          </p>
          <v-btn
            class="ml-4 self-start text-xs font-medium"
            color="error"
            size="small"
            variant="text"
            @click="emit('compromised')"
          >
            Revoke now instead
          </v-btn>
        </div>

        <p v-if="error" class="m-0 text-xs leading-5 text-error" role="alert">{{ error }}</p>

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
            Create replacement
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>

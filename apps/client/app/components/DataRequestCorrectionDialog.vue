<script setup lang="ts">
/**
 * Records what a rectification changed. The change itself is made on the account, where
 * every other edit to it is made and audited; this writes down what it was, so the request
 * and the change read as one story and the request has evidence to close on.
 */
import type { Refusal } from "~/stores/data-requests";
import type { DataSubjectRequest } from "~/utils/data-requests";
import { nameOf, type ProjectUser } from "~/utils/users";

const props = defineProps<{
  request: DataSubjectRequest;
  user: ProjectUser | null;
  /** Writes it, and resolves to null or the sentence saying why it was refused. */
  submit: (summary: string) => Promise<Refusal>;
}>();

const open = defineModel<boolean>({ required: true });

const titleId = `${useId()}-title`;

const summary = ref("");
const touched = ref(false);
const busy = ref(false);
const failure = ref("");

const issue = computed(() => (summary.value.trim() === "" ? "Say what was corrected." : ""));

async function submit() {
  touched.value = true;
  failure.value = "";
  if (issue.value !== "" || busy.value) return;
  busy.value = true;
  try {
    const refusal = await props.submit(summary.value);
    if (refusal === null) open.value = false;
    else failure.value = refusal;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <v-dialog v-model="open" :aria-labelledby="titleId" :persistent="busy" max-width="480">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" novalidate @submit.prevent="submit">
        <header class="flex flex-col gap-1">
          <h2 :id="titleId" class="m-0 text-sm font-medium text-ink">Record the correction</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            Make the change on
            <span class="font-medium text-ink/80">{{ user ? nameOf(user) : "the account" }}</span
            >'s account first. This records what changed, so the request has evidence to
            close on.
          </p>
          <NuxtLink
            v-if="user && user.deletedAt === null"
            :to="`/users/${user.id}`"
            class="mt-1 inline-flex items-center gap-1 self-start text-xs font-medium text-ink/70 no-underline hover:text-ink hover:underline"
          >
            <Icon aria-hidden="true" class="text-sm" name="material-symbols:person-outline" />
            Open the account
          </NuxtLink>
        </header>

        <div class="flex flex-col gap-2">
          <label class="text-xs font-medium text-ink" for="dsr-correction">What was corrected</label>
          <v-textarea
            id="dsr-correction"
            v-model="summary"
            :disabled="busy"
            :error="touched && issue !== ''"
            auto-grow
            autofocus
            hide-details
            placeholder="Display name corrected at their request."
            rows="3"
            variant="filled"
          />
          <p
            :class="touched && issue ? 'text-error' : 'text-ink/50'"
            class="m-0 text-[11px] leading-4"
          >
            {{ touched && issue ? issue : "Which field, and that it now reads as they asked." }}
          </p>
        </div>

        <p v-if="failure" class="m-0 text-[11px] leading-4 text-error" role="alert">
          {{ failure }}
        </p>

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
            :loading="busy"
            class="text-xs font-medium"
            color="primary"
            size="small"
            type="submit"
            variant="flat"
          >
            Record correction
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>

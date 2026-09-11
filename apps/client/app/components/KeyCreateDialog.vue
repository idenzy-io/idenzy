<script setup lang="ts">
/**
 * Makes a key, and asks one thing: where it will be used, in the reader's words (notes/keys.md).
 * Purpose is asked only if the API keeps it and scope only if something enforces it, and
 * today neither is true, so neither is a field here.
 *
 * A second live key of a kind is allowed and is not a rotation, so where one exists the footer
 * leads with Rotate on it, and its tooltip says why: the mistake it heads off is somebody
 * making a second key, deploying it, and believing the first retired itself.
 *
 * Mounted by the page only while open, and closed by the page once the key exists, so a failed
 * request leaves the choice on screen with the error under it (notes/dialogs.md P1).
 */
import type { SegmentedOption } from "~/components/SegmentedControl.vue";
import {
  API_KEY_KINDS,
  type ApiKeyKind,
  KEY_FORMAT,
  KEY_KIND_LABELS,
  KEY_USES,
  type ProjectApiKey,
} from "~/utils/keys";

const props = defineProps<{
  busy: boolean;
  projectName: string;
  /** Chosen when the dialog opens: the tab the reader was on. */
  suggested: ApiKeyKind;
  /** Live keys of each kind, newest first, so the dialog can name the one to rotate. */
  live: Record<ApiKeyKind, readonly ProjectApiKey[]>;
  error: string;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [kind: ApiKeyKind];
  rotate: [key: ProjectApiKey];
}>();

const titleId = `${useId()}-title`;
const kind = ref<ApiKeyKind>(props.suggested);

const OPTIONS: readonly SegmentedOption[] = API_KEY_KINDS.map((entry) => ({
  value: entry,
  label: KEY_USES[entry].label,
}));

const existing = computed(() => props.live[kind.value]);
const newest = computed(() => existing.value[0] ?? null);
</script>

<template>
  <v-dialog v-model="open" :aria-labelledby="titleId" max-width="480">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="emit('confirm', kind)">
        <header class="flex flex-col gap-1">
          <h2 :id="titleId" class="m-0 text-base font-medium text-ink">Create an API key</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            A key for <span class="font-medium text-ink">{{ projectName }}</span>, shown once on
            the next screen and kept only as a {{ KEY_FORMAT.digest }} digest.
          </p>
        </header>

        <div class="flex flex-col gap-2">
          <span class="text-xs font-medium text-ink">Where will it be used?</span>
          <SegmentedControl v-model="kind" :options="OPTIONS" label="Where it will be used" stretch />
          <p class="m-0 text-xs leading-5 text-ink/60">{{ KEY_USES[kind].description }}</p>
        </div>

        <p v-if="error" class="m-0 text-xs leading-5 text-error" role="alert">{{ error }}</p>

        <footer class="flex flex-wrap items-center justify-end gap-2">
          <v-btn
            v-if="newest"
            class="mr-auto -ml-2 text-xs font-medium"
            color="neutral"
            prepend-icon="material-symbols:swap-horiz"
            size="small"
            variant="text"
            @click="emit('rotate', newest)"
          >
            Rotate {{ newest.prefix }}…
            <v-tooltip
              :text="`A new key does not replace ${newest.prefix}…: both work until one is revoked. Rotating it replaces it without downtime.`"
              activator="parent"
              location="top"
              max-width="280"
            />
          </v-btn>
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
            Create {{ KEY_KIND_LABELS[kind].toLowerCase() }}
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>

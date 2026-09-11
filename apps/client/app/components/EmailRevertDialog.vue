<script setup lang="ts">
/**
 * Removing this project's copy for one language, which is a revert rather than a delete:
 * every message has a built-in behind it and the mail keeps sending.
 *
 * **It shows the copy that would take over, before the decision.** That is the whole
 * point of the dialog. "Revert to the built-in" is not a consequence somebody can picture,
 * and the answer is often not the built-in at all: a project holding `en` and `tr` that
 * reverts `tr` sends its own English to Turkish readers, because the project's whole
 * fallback chain is tried before any copy of ours. Naming the wrong replacement is worse
 * than naming none.
 *
 * The subject shown is rendered with sample values, as the catalogue's is, because a
 * template with braces in it is not what a reader would receive and this is a question
 * about what they will receive.
 */

const props = defineProps<{
  /** The message being reverted, in the reader's words. */
  message: string;
  locale: string;
  /** What takes over: the language that answers next, and whose copy that is. */
  fallbackLocale: string;
  fallbackSource: "yours" | "built_in";
  /** That copy's subject, already substituted. */
  fallbackSubject: string;
  /** True where unpublished work for this language goes with it. */
  hasDraft: boolean;
  busy?: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [];
}>();

const titleId = `${useId()}-revert-title`;

const replacement = computed(() =>
  props.fallbackSource === "yours"
    ? `your ${props.fallbackLocale} copy`
    : `our built-in ${props.fallbackLocale} copy`,
);
</script>

<template>
  <v-dialog v-model="open" :persistent="busy" max-width="560">
    <v-card :aria-labelledby="titleId" border flat role="dialog">
      <div class="flex flex-col gap-5 p-5">
        <header class="flex flex-col gap-1">
          <h2 :id="titleId" class="m-0 text-sm font-medium text-ink">
            Remove your {{ locale }} copy of {{ message }}?
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            The message keeps sending. What changes is whose words a reader in
            <span class="font-mono text-ink/80">{{ locale }}</span> receives, which becomes
            {{ replacement }}.
          </p>
        </header>

        <!-- Before and after, as the copy itself rather than as a description of it. -->
        <div class="overflow-hidden rounded-(--idenzy-radius-small) border border-line">
          <div class="flex flex-col gap-1 border-b border-line bg-canvas/60 px-3 py-2.5">
            <span class="text-[10px] leading-4 font-medium text-ink/50">
              After this, a reader in {{ locale }} gets
            </span>
            <span class="flex min-w-0 items-center gap-2">
              <span
                class="inline-flex flex-none rounded-full border border-line px-1.5 font-mono text-[10px] leading-4 text-ink/60"
              >
                {{ fallbackLocale }}
              </span>
              <span
                :class="fallbackSource === 'yours' ? 'text-success' : 'text-ink/50'"
                class="flex-none text-[10px] leading-4 font-medium"
              >
                {{ fallbackSource === "yours" ? "Your copy" : "Our built-in" }}
              </span>
            </span>
          </div>
          <p class="m-0 px-3 py-2.5 text-xs leading-5 text-ink">
            {{ fallbackSubject || "No subject" }}
          </p>
        </div>

        <p
          v-if="hasDraft"
          class="m-0 flex items-start gap-1.5 text-[11px] leading-4 text-warning"
        >
          <Icon
            aria-hidden="true"
            class="mt-px flex-none text-sm"
            name="material-symbols:warning-outline"
          />
          <span>
            Unpublished changes for {{ locale }} go with it. They are not saved anywhere and
            cannot be recovered.
          </span>
        </p>

        <p class="m-0 text-[11px] leading-4 text-ink/50">
          You can write {{ locale }} again at any time; this removes the stored copy, not
          the language.
        </p>

        <footer class="flex flex-wrap items-center justify-between gap-3">
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
            color="error"
            size="small"
            variant="flat"
            @click="emit('confirm')"
          >
            Remove {{ locale }} copy
          </v-btn>
        </footer>
      </div>
    </v-card>
  </v-dialog>
</template>

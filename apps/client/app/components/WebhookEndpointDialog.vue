<script setup lang="ts">
/**
 * An endpoint: where to call, and what to call about.
 *
 * "Every event" is a choice of its own rather than every box ticked, because the two mean
 * different things the day we add an event. A customer who ticked thirteen boxes asked
 * for those thirteen; one who chose everything asked to be told about whatever comes
 * next. Collapsing them would quietly subscribe somebody to an event they have never seen
 * a payload for.
 *
 * The same dialog edits, so the events a running endpoint takes can be changed without
 * touching its secret. What it never does is show the secret: that is its own dialog, and
 * a value shown once does not belong beside a form somebody is going to submit twice.
 */
import {
  ENDPOINT_ISSUE_LABELS,
  EVENT_GROUP_LABELS,
  EVENT_GROUPS,
  eventsIn,
  normaliseEndpointUrl,
  validateEndpointUrl,
  type WebhookEndpoint,
} from "~/utils/webhooks";

const props = defineProps<{
  /** The endpoint being changed, or null when one is being made. */
  endpoint: WebhookEndpoint | null;
  /** The URLs this project already sends to, so a duplicate is refused before the call. */
  existing: readonly string[];
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [draft: { url: string; description: string; events: string[]; allEvents: boolean }];
}>();

const url = ref("");
const description = ref("");
const chosen = ref<string[]>([]);
const everything = ref(true);
/* Focused once the dialog has finished entering; `autofocus` loses to the overlay's own focus. */
const field = useTemplateRef<{ focus: () => void }>("field");

watch(open, (value) => {
  if (!value) return;
  url.value = props.endpoint?.url ?? "";
  description.value = props.endpoint?.description ?? "";
  chosen.value = [...(props.endpoint?.events ?? [])];
  everything.value = props.endpoint?.allEvents ?? true;
});

/** The endpoint being edited keeps its own URL, so it is not a duplicate of itself. */
const others = computed(() =>
  props.existing.filter((entry) => entry !== normaliseEndpointUrl(props.endpoint?.url ?? "")),
);

const urlIssue = computed(() => {
  if (url.value.trim() === "") return "";
  const found = validateEndpointUrl(url.value, others.value);
  return found === null ? "" : ENDPOINT_ISSUE_LABELS[found];
});

const noEvents = computed(() => !everything.value && chosen.value.length === 0);

const ready = computed(() => url.value.trim() !== "" && urlIssue.value === "" && !noEvents.value);

function toggleEvent(id: string) {
  chosen.value = chosen.value.includes(id)
    ? chosen.value.filter((entry) => entry !== id)
    : [...chosen.value, id];
}

function confirm() {
  if (!ready.value || props.busy) return;
  emit("confirm", {
    url: normaliseEndpointUrl(url.value),
    description: description.value.trim(),
    events: everything.value ? [] : [...chosen.value],
    allEvents: everything.value,
  });
}
</script>

<template>
  <v-dialog v-model="open" max-width="560" scrollable @after-enter="field?.focus()">
    <v-card border flat>
      <form class="flex min-h-0 flex-col" @submit.prevent="confirm">
        <header class="flex flex-col gap-1 border-b border-line px-5 py-4">
          <h2 class="m-0 text-sm font-medium text-ink">
            {{ endpoint ? "Edit endpoint" : "Add an endpoint" }}
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            We call this URL when something on the list happens. Answer 2xx and answer
            fast: anything else is a failure and gets retried, and a slow handler is a
            timeout.
          </p>
        </header>

        <div class="flex flex-col gap-5 overflow-y-auto px-5 py-5">
          <div class="flex flex-col gap-1">
            <label class="text-xs font-medium text-ink" for="webhook-url">Endpoint URL</label>
            <v-text-field
              id="webhook-url"
              ref="field"
              v-model="url"
              :error="urlIssue !== ''"
              autocomplete="off"
              class="font-mono"
              hide-details
              placeholder="https://api.example.com/hooks/idenzy"
              variant="filled"
            />
            <p :class="urlIssue ? 'text-error' : 'text-ink/50'" class="m-0 text-[11px] leading-4">
              {{ urlIssue || "https only, and a host we can reach from our own network." }}
            </p>
          </div>

          <div class="flex flex-col gap-1">
            <label class="text-xs font-medium text-ink" for="webhook-description">
              What it is for
            </label>
            <v-text-field
              id="webhook-description"
              v-model="description"
              hide-details
              placeholder="Provisioning and account sync"
              variant="filled"
            />
            <p class="m-0 text-[11px] leading-4 text-ink/50">
              Optional, and worth writing: a list of four URLs is not a list of four
              purposes.
            </p>
          </div>

          <section class="flex flex-col gap-3">
            <div class="flex flex-col gap-1">
              <span class="text-xs font-medium text-ink">Events</span>
              <p
                :class="noEvents ? 'text-error' : 'text-ink/50'"
                class="m-0 text-[11px] leading-4"
              >
                {{ noEvents ? ENDPOINT_ISSUE_LABELS.events_empty : "What this endpoint is called about." }}
              </p>
            </div>

            <label
              class="flex cursor-pointer items-start gap-2 rounded-(--idenzy-radius-small) border border-line bg-canvas p-3"
            >
              <v-checkbox-btn
                v-model="everything"
                class="-mt-1.5 -ml-1.5"
                color="primary"
                density="compact"
              />
              <span class="flex flex-col gap-0.5 pt-px">
                <span class="text-xs font-medium text-ink">Every event</span>
                <span class="text-[11px] leading-4 text-ink/55">
                  Including ones added after today. A handler that ignores what it does not
                  recognise wants this; one that switches on the type exhaustively does not.
                </span>
              </span>
            </label>

            <div v-if="!everything" class="flex flex-col gap-4">
              <div v-for="group in EVENT_GROUPS" :key="group" class="flex flex-col gap-1.5">
                <span class="text-[11px] font-medium text-ink/60">
                  {{ EVENT_GROUP_LABELS[group] }}
                </span>
                <label
                  v-for="event in eventsIn(group)"
                  :key="event.id"
                  class="flex cursor-pointer items-start gap-2"
                >
                  <v-checkbox-btn
                    :model-value="chosen.includes(event.id)"
                    class="-mt-1.5 -ml-1.5"
                    color="primary"
                    density="compact"
                    @update:model-value="toggleEvent(event.id)"
                  />
                  <span class="flex min-w-0 flex-col gap-0.5 pt-px">
                    <span class="font-mono text-[11px] text-ink">{{ event.id }}</span>
                    <span class="text-[11px] leading-4 text-ink/55">{{ event.note }}</span>
                  </span>
                </label>
              </div>
            </div>
          </section>
        </div>

        <footer class="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
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
            :disabled="!ready"
            :loading="busy"
            class="text-xs font-medium"
            color="primary"
            size="small"
            type="submit"
            variant="flat"
          >
            {{ endpoint ? "Save endpoint" : "Add endpoint" }}
          </v-btn>
        </footer>
      </form>
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

<script setup lang="ts">
/**
 * An endpoint, in the note's order: the URL, the events in their groups, an example of what
 * arrives, then whether it starts delivering (notes/webhooks.md).
 *
 * "Every event" is its own choice rather than every box ticked, because the two differ the day
 * we add an event: one asked for whatever comes next, the other for the thirteen it ticked. The
 * groups are an accordion with the first one open, so a long list is one screen and not four.
 *
 * A new endpoint starts off unless somebody asks otherwise, because a test event should prove
 * the URL answers and the signature verifies before real events go to it. Editing never shows
 * the secret: that is its own dialog, and a value shown once does not belong beside a form.
 *
 * Mounted by the page only while open, and closed by it once the write lands, so a failed save
 * keeps what was typed and says so (notes/dialogs.md). A full-height sheet below `lg`.
 */
import {
  ENDPOINT_ISSUE_LABELS,
  normaliseEndpointUrl,
  samplePayload,
  validateEndpointUrl,
  WEBHOOK_DELIVERY,
  type WebhookEndpoint,
} from "~/utils/webhooks";

const props = defineProps<{
  /** The endpoint being changed, or null when one is being made. */
  endpoint: WebhookEndpoint | null;
  /** The URLs this project already sends to, so a duplicate is refused before the call. */
  existing: readonly string[];
  projectName: string;
  busy: boolean;
  error: string;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [
    draft: {
      url: string;
      description: string;
      events: string[];
      allEvents: boolean;
      enabled: boolean;
    },
  ];
}>();

const { lgAndUp } = useDisplay();
const titleId = `${useId()}-title`;

const url = ref(props.endpoint?.url ?? "");
const description = ref(props.endpoint?.description ?? "");
const chosen = ref<string[]>([...(props.endpoint?.events ?? [])]);
const everything = ref(props.endpoint?.allEvents ?? true);
const startNow = ref(props.endpoint?.enabled ?? false);
const touched = ref(false);

/* Focused once the dialog has finished entering; `autofocus` loses to the overlay's own focus. */
const field = useTemplateRef<{ focus: () => void }>("field");

/** The endpoint being edited keeps its own URL, so it is not a duplicate of itself. */
const others = computed(() =>
  props.existing.filter((entry) => entry !== normaliseEndpointUrl(props.endpoint?.url ?? "")),
);

const urlIssue = computed(() => {
  if (url.value.trim() === "") return touched.value ? ENDPOINT_ISSUE_LABELS.url_invalid : "";
  const found = validateEndpointUrl(url.value, others.value);
  return found === null ? "" : ENDPOINT_ISSUE_LABELS[found];
});

const noEvents = computed(() => !everything.value && chosen.value.length === 0);

/* An empty choice is only an error once somebody tries to save it: unticking Every event
   is the start of choosing, not a mistake (layout blueprint, field layout). */
const submitted = ref(false);
const eventsError = computed(() => noEvents.value && submitted.value);

const ready = computed(() => url.value.trim() !== "" && urlIssue.value === "" && !noEvents.value);

/** What a delivery of the first chosen event looks like, so the reader sees a real shape. */
const example = computed(() =>
  samplePayload(
    everything.value ? "user.created" : (chosen.value[0] ?? "user.created"),
    "dlv_9c1f4a7b20e5",
    "2026-09-09T18:42:11.203Z",
  ),
);

function confirm() {
  touched.value = true;
  submitted.value = true;
  if (!ready.value || props.busy) return;
  emit("confirm", {
    url: normaliseEndpointUrl(url.value),
    description: description.value.trim(),
    events: everything.value ? [] : [...chosen.value],
    allEvents: everything.value,
    enabled: props.endpoint ? props.endpoint.enabled : startNow.value,
  });
}
</script>

<template>
  <v-dialog
    v-model="open"
    :aria-labelledby="titleId"
    :fullscreen="!lgAndUp"
    :max-width="lgAndUp ? 600 : undefined"
    :transition="lgAndUp ? undefined : 'dialog-bottom-transition'"
    scrollable
    width="100%"
    @after-enter="field?.focus()"
  >
    <v-card border flat>
      <form
        :class="lgAndUp ? 'max-h-[86vh]' : 'h-full'"
        class="flex min-h-0 flex-col"
        @submit.prevent="confirm"
      >
        <header class="flex flex-none flex-col gap-1 border-b border-line px-5 py-4">
          <h2 :id="titleId" class="m-0 text-base font-medium text-ink">
            {{ endpoint ? "Edit endpoint" : "Add endpoint" }}
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            A URL on <span class="font-medium text-ink">{{ projectName }}</span> that we call
            when something on its list happens. Answer 2xx and answer fast: anything else is a
            failure and is tried again.
          </p>
        </header>

        <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
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
              @blur="touched = true"
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
              Optional. A list of four URLs is not a list of four purposes.
            </p>
          </div>

          <section class="flex flex-col gap-2">
            <div class="flex flex-col gap-0.5">
              <span class="text-xs font-medium text-ink">Events</span>
              <p :class="eventsError ? 'text-error' : 'text-ink/50'" class="m-0 text-[11px] leading-4">
                {{ eventsError ? ENDPOINT_ISSUE_LABELS.events_empty : "What this endpoint is called about." }}
              </p>
            </div>

            <label
              class="flex cursor-pointer items-start gap-1 rounded-(--idenzy-radius-small) bg-ink/4 py-2 pr-3 pl-2 ring-1 ring-ink/6 ring-inset"
            >
              <v-checkbox-btn
                v-model="everything"
                class="-mt-0.5 flex-none"
                color="primary"
                density="compact"
              />
              <span class="flex flex-col gap-0.5 pt-1">
                <span class="text-xs font-medium text-ink">Every event</span>
                <span class="text-[11px] leading-4 text-ink/55">
                  Including ones added after today. Right for a handler that ignores what it
                  does not recognise, wrong for one that switches on the type exhaustively.
                </span>
              </span>
            </label>

            <WebhookEventGroups v-if="!everything" v-model="chosen" />
          </section>

          <section class="flex flex-col gap-1.5">
            <span class="text-xs font-medium text-ink">What arrives</span>
            <div
              class="overflow-x-auto rounded-(--idenzy-radius-small) bg-ink/4 px-3 py-2.5 ring-1 ring-ink/6 ring-inset"
            >
              <CodeBlock :code="example" lang="json" />
            </div>
            <p class="m-0 text-[11px] leading-4 text-ink/50">
              Signed, with the delivery ID in a header as well. Key your side on it: the same
              delivery can arrive twice.
            </p>
          </section>

          <label v-if="!endpoint" class="flex cursor-pointer items-start gap-1">
            <v-checkbox-btn v-model="startNow" class="-mt-0.5 flex-none" color="primary" density="compact" />
            <span class="flex flex-col gap-0.5 pt-1">
              <span class="text-xs font-medium text-ink">Start delivering as soon as it is saved</span>
              <span class="text-[11px] leading-4 text-ink/55">
                Leave it off to send a test event first.
                <template v-if="!WEBHOOK_DELIVERY.running">
                  Nothing is sent on this deployment either way yet.
                </template>
              </span>
            </span>
          </label>

          <p v-if="error" class="m-0 text-xs leading-5 text-error" role="alert">{{ error }}</p>
        </div>

        <footer class="flex flex-none items-center justify-end gap-2 border-t border-line px-5 py-3">
          <v-btn
            class="text-xs font-medium"
            color="neutral"
            size="small"
            variant="text"
            @click="open = false"
          >
            Cancel
          </v-btn>
          <!-- Never disabled: pressing it on an incomplete form is what shows each field's
               problem, rather than a greyed button nobody can ask why. -->
          <v-btn
            :loading="busy"
            class="text-xs font-medium"
            color="primary"
            size="small"
            type="submit"
            variant="flat"
          >
            Save endpoint
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

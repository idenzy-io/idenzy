<script setup lang="ts">
/**
 * One request in full: whose, what, how long is left, and what finishing it does.
 *
 * The window is drawn as a meter rather than stated as a date, because the question is
 * never "when is it due" on its own, it is "how much of the month is gone". An overdue
 * one fills and turns, which is the only red on this screen.
 *
 * An erasure's panel lists what survives it. That is not a disclaimer: the reconciliation
 * of Article 17 with Article 17(3)(b) is the part an auditor reads, and an operator about
 * to run one should know the audit trail stays intact before they run it rather than
 * afterwards.
 */
import {
  ARTIFACT_TTL_DAYS,
  artifactExpiresAt,
  type DataSubjectRequest,
  dueTone,
  dueWords,
  ERASURE_KEEPS,
  isArtifactLive,
  isOpen,
  kindInfo,
  REQUEST_STATUS_TONES,
  statusLabel,
  windowUsed,
} from "~/utils/data-requests";
import { formatDate, formatDateTime } from "~/utils/time";

const props = defineProps<{
  request: DataSubjectRequest | null;
  now: Date;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  start: [];
  complete: [];
  refuse: [];
}>();

const info = computed(() => (props.request === null ? null : kindInfo(props.request.kind)));
const used = computed(() => (props.request === null ? 0 : windowUsed(props.request, props.now)));
const tone = computed(() =>
  props.request === null ? "neutral" : dueTone(props.request, props.now),
);
const live = computed(() => props.request !== null && isArtifactLive(props.request, props.now));
const expires = computed(() => (props.request === null ? null : artifactExpiresAt(props.request)));

const METER: Record<string, string> = {
  success: "bg-primary",
  warning: "bg-warning",
  error: "bg-error",
  neutral: "bg-ink/25",
};
</script>

<template>
  <v-dialog v-model="open" max-width="560" scrollable>
    <v-card v-if="request && info" border flat>
      <header class="flex flex-col gap-2 border-b border-line px-5 py-4">
        <div class="flex flex-wrap items-center gap-2">
          <Icon :name="info.icon" aria-hidden="true" class="flex-none text-base text-ink/70" />
          <h2 class="m-0 text-sm font-medium text-ink">{{ info.label }}</h2>
          <span
            class="rounded-full border border-line px-1.5 font-mono text-[10px] leading-4 text-ink/55"
          >
            {{ info.article }}
          </span>
          <StatusBadge
            :label="statusLabel(request.status)"
            :tone="REQUEST_STATUS_TONES[request.status]"
          />
        </div>
        <p class="m-0 truncate font-mono text-xs text-ink/70">{{ request.subjectLabel }}</p>
      </header>

      <div class="flex flex-col gap-5 overflow-y-auto px-5 py-5">
        <section class="flex flex-col gap-2">
          <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span class="text-xs font-medium text-ink">{{ dueWords(request, now) }}</span>
            <span class="text-[11px] text-ink/55">Due {{ formatDate(request.dueAt) }}</span>
          </div>
          <span class="block h-1.5 overflow-hidden rounded-full bg-ink/8">
            <span
              :class="METER[tone]"
              :style="{ width: `${used * 100}%` }"
              class="block h-full rounded-full"
            />
          </span>
          <p class="m-0 text-[11px] leading-4 text-ink/55">
            The statutory month, from the day it was logged. It is computed at intake and
            monitored, so an overdue request pages somebody rather than waiting to be
            noticed.
          </p>
        </section>

        <dl class="m-0 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div class="flex min-w-0 flex-col gap-0.5">
            <dt class="text-[10px] text-ink/45">Requested</dt>
            <dd class="m-0 text-[11px] text-ink/80">{{ formatDateTime(request.requestedAt) }}</dd>
          </div>
          <div class="flex min-w-0 flex-col gap-0.5">
            <dt class="text-[10px] text-ink/45">Completed</dt>
            <dd class="m-0 text-[11px] text-ink/80">
              {{ request.completedAt ? formatDateTime(request.completedAt) : "Not yet" }}
            </dd>
          </div>
          <div class="flex min-w-0 flex-col gap-0.5">
            <dt class="text-[10px] text-ink/45">Subject id</dt>
            <dd class="m-0 truncate font-mono text-[11px] text-ink/80">
              {{ request.subjectUserId }}
            </dd>
          </div>
          <div class="flex min-w-0 flex-col gap-0.5">
            <dt class="text-[10px] text-ink/45">Taken down by</dt>
            <dd class="m-0 truncate text-[11px] text-ink/80">{{ request.requestedBy }}</dd>
          </div>
        </dl>

        <section class="flex flex-col gap-1.5">
          <span class="text-[10px] text-ink/45">What it does</span>
          <p class="m-0 text-[11px] leading-4 text-ink/70">{{ info.note }}</p>
        </section>

        <!-- The bundle, while there is one. A completed export whose link has aged out
             still reads as completed: the obligation was met, and a copy of everything
             about a person was not left lying around afterwards. -->
        <section v-if="info.producesArtifact && request.completedAt" class="flex flex-col gap-1.5">
          <span class="text-[10px] text-ink/45">The bundle</span>
          <CopyField
            v-if="live && request.artifactUri"
            :value="request.artifactUri"
            label="Copy the export link"
          />
          <p
            v-else
            class="m-0 rounded-(--idenzy-radius-x-small) border border-line bg-canvas px-3 py-2 text-[11px] leading-4 text-ink/55"
          >
            The bundle has expired and is gone. Completing the request is what met the
            obligation; keeping a copy of everything about a person afterwards is not part
            of it.
          </p>
          <p v-if="live && expires" class="m-0 text-[11px] leading-4 text-ink/55">
            Expires {{ formatDate(expires) }}, {{ ARTIFACT_TTL_DAYS }} days after it was
            built.
          </p>
        </section>

        <section v-if="request.kind === 'erasure'" class="flex flex-col gap-2">
          <span class="text-[10px] text-ink/45">What survives it</span>
          <ul class="m-0 flex list-none flex-col gap-2 p-0">
            <li v-for="kept in ERASURE_KEEPS" :key="kept.what" class="flex items-start gap-2">
              <Icon
                aria-hidden="true"
                class="mt-0.5 flex-none text-sm text-ink/40"
                name="material-symbols:shield-outline"
              />
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="text-[11px] font-medium text-ink">{{ kept.what }}</span>
                <span class="text-[11px] leading-4 text-ink/55">{{ kept.why }}</span>
              </span>
            </li>
          </ul>
        </section>
      </div>

      <footer class="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
        <template v-if="isOpen(request.status)">
          <v-btn
            :loading="busy"
            class="mr-auto text-xs font-medium"
            color="neutral"
            size="small"
            variant="text"
            @click="emit('refuse')"
          >
            Refuse it
          </v-btn>
          <v-btn
            v-if="request.status === 'received'"
            :loading="busy"
            class="text-xs font-medium"
            color="neutral"
            size="small"
            variant="outlined"
            @click="emit('start')"
          >
            Start work
          </v-btn>
          <v-btn
            :loading="busy"
            class="text-xs font-medium"
            color="primary"
            size="small"
            variant="flat"
            @click="emit('complete')"
          >
            Mark completed
          </v-btn>
        </template>
        <v-btn
          v-else
          class="text-xs font-medium"
          color="neutral"
          size="small"
          variant="text"
          @click="open = false"
        >
          Close
        </v-btn>
      </footer>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
/**
 * Extends a deadline, the one time a rule allows, with the before and after stated first.
 * An extension is a claim that the request is complex or one of many, so it carries its
 * reason, the second member who agreed, and the day the person was told, which has to fall
 * inside the first period (notes/data-requests.md P1: an audited extension with review).
 */
import type { ExtensionInput, Refusal } from "~/stores/data-requests";
import {
  type DataSubjectRequest,
  dateInput,
  dateIssue,
  extendedDue,
  fromInputs,
  RULE_INFO,
} from "~/utils/data-requests";
import { type Member, roleInfo } from "~/utils/members";
import { formatDate } from "~/utils/time";

const props = defineProps<{
  request: DataSubjectRequest;
  /** Members who may review it: an owner or an admin other than the reader. */
  reviewers: readonly Member[];
  now: Date;
  /** Writes it, and resolves to null or the sentence saying why it was refused. */
  submit: (input: ExtensionInput) => Promise<Refusal>;
}>();

const open = defineModel<boolean>({ required: true });

const titleId = `${useId()}-title`;

const reason = ref("");
const reviewerId = ref<string | null>(null);
const toldOn = ref(dateInput(props.now));

const touched = ref(false);
const busy = ref(false);
const failure = ref("");

const rule = computed(() => RULE_INFO[props.request.rule]);
const after = computed(() => extendedDue(props.request.dueAt, props.request.rule));
const reviewer = computed(
  () => props.reviewers.find((member) => member.id === reviewerId.value) ?? null,
);
const toldAt = computed(() => fromInputs(toldOn.value));

const issues = computed(() => {
  const list: { reason?: string; reviewer?: string; toldAt?: string } = {};
  if (reason.value.trim() === "") list.reason = "Say why it needs longer. They are told the same.";
  if (reviewer.value === null) list.reviewer = "Choose who reviewed it.";
  const day = dateIssue(toldAt.value, props.request.receivedAt, props.now);
  if (day !== null) list.toldAt = day;
  else if (toldAt.value !== null && Date.parse(toldAt.value) > Date.parse(props.request.dueAt)) {
    list.toldAt = `They have to be told inside the first ${rule.value.period}.`;
  }
  return list;
});

const shown = computed(() => (touched.value ? issues.value : {}));

async function submit() {
  touched.value = true;
  failure.value = "";
  const by = reviewer.value;
  const at = toldAt.value;
  if (Object.keys(issues.value).length > 0 || by === null || at === null || busy.value) return;
  busy.value = true;
  try {
    const refusal = await props.submit({ reason: reason.value, reviewedBy: by.name, toldAt: at });
    if (refusal === null) open.value = false;
    else failure.value = refusal;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <v-dialog v-model="open" :aria-labelledby="titleId" :persistent="busy" max-width="500">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" novalidate @submit.prevent="submit">
        <header class="flex flex-col gap-1">
          <h2 :id="titleId" class="m-0 text-sm font-medium text-ink">Extend the deadline</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">{{ rule.note }}</p>
        </header>

        <p
          class="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-(--idenzy-radius-small) bg-ink/4 px-3 py-2.5 text-xs ring-1 ring-ink/6 ring-inset"
        >
          <span class="text-ink/60">Due</span>
          <span class="font-medium text-ink/70 line-through decoration-ink/30">
            {{ formatDate(request.dueAt) }}
          </span>
          <Icon aria-hidden="true" class="text-sm text-ink/45" name="material-symbols:arrow-forward" />
          <span class="font-medium text-ink">{{ formatDate(after) }}</span>
          <span class="text-ink/50">· {{ rule.extension }} more, the most the rule allows</span>
        </p>

        <div class="flex flex-col gap-2">
          <label class="text-xs font-medium text-ink" for="dsr-extend-reason">Why it needs longer</label>
          <v-textarea
            id="dsr-extend-reason"
            v-model="reason"
            :disabled="busy"
            :error="shown.reason !== undefined"
            auto-grow
            hide-details
            placeholder="What makes this request complex, or one of many."
            rows="2"
            variant="filled"
          />
          <p v-if="shown.reason" class="m-0 text-[11px] leading-4 text-error">{{ shown.reason }}</p>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-xs font-medium text-ink" for="dsr-extend-reviewer">Reviewed by</label>
          <!-- Drawn like the filled fields beside it, as the claim form's field picker is. -->
          <button
            id="dsr-extend-reviewer"
            :class="shown.reviewer ? 'border-error' : 'border-ink/25'"
            :disabled="busy"
            aria-haspopup="menu"
            class="group flex h-10 w-full items-center justify-between gap-2 rounded-t-(--idenzy-radius) border-b bg-ink/5 px-3 text-left text-sm text-ink transition-colors duration-150 hover:border-ink/45 hover:bg-ink/8 focus-visible:border-primary focus-visible:outline-none"
            type="button"
          >
            <span :class="reviewer ? 'text-ink' : 'text-ink/50'" class="truncate">
              {{ reviewer?.name ?? "Choose a member" }}
            </span>
            <Icon
              aria-hidden="true"
              class="flex-none text-base text-ink/45 transition-colors duration-150 group-hover:text-ink/80"
              name="material-symbols:unfold-more"
            />
            <v-menu :offset="6" activator="parent" location="bottom start">
              <v-list density="compact" min-width="260" nav>
                <v-list-item
                  v-for="member in reviewers"
                  :key="member.id"
                  :active="member.id === reviewerId"
                  :subtitle="roleInfo(member.role).label"
                  :title="member.name"
                  @click="reviewerId = member.id"
                />
              </v-list>
            </v-menu>
          </button>
          <p :class="shown.reviewer ? 'text-error' : 'text-ink/50'" class="m-0 text-[11px] leading-4">
            {{ shown.reviewer ?? "An owner or an admin other than you, who agreed it is needed." }}
          </p>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-xs font-medium text-ink" for="dsr-extend-told">Told them on</label>
          <v-text-field
            id="dsr-extend-told"
            v-model="toldOn"
            :disabled="busy"
            :error="shown.toldAt !== undefined"
            hide-details
            type="date"
            variant="filled"
          />
          <p :class="shown.toldAt ? 'text-error' : 'text-ink/50'" class="m-0 text-[11px] leading-4">
            {{ shown.toldAt ?? "With the reason, before the first deadline passes." }}
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
            Extend to {{ formatDate(after) }}
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>

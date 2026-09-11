<script setup lang="ts">
/**
 * What an export is about to contain, before it lands on somebody's disk.
 *
 * The button says "Export filtered view" and this is what makes that true: the project,
 * the period, the count and every filter in force, plus the one line that matters most —
 * whether the customer's own users' activity is in the file or out of it. An auditor who
 * exports a narrowed view and later reads it as the whole trail has made the mistake this
 * dialog exists to stop (notes/audit.md).
 *
 * It is a review and not a form. Nothing here changes the filters: the way to export
 * something else is to close this and narrow the view, because a second set of controls
 * would be a second answer to what the file holds.
 */
import { type AuditScopeLine, EXPORT_CAVEAT } from "~/utils/audit";

defineProps<{
  scope: readonly AuditScopeLine[];
  /** Nothing to export, which is a different thing from a failed one. */
  empty: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{ confirm: [] }>();

const titleId = `${useId()}-title`;
</script>

<template>
  <v-dialog v-model="open" :aria-labelledby="titleId" max-width="520" scrollable>
    <v-card border flat>
      <div class="flex max-h-[86vh] flex-col">
        <header class="flex flex-none flex-col gap-1 px-5 py-4">
          <h2 :id="titleId" class="m-0 text-sm font-medium text-ink">Export this view</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            A CSV of the entries on screen. Check the scope below against what you meant to
            take away.
          </p>
        </header>

        <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto border-t border-line px-5 py-5">
          <dl
            class="m-0 flex flex-col divide-y divide-line rounded-(--idenzy-radius-small) bg-ink/4 ring-1 ring-ink/6 ring-inset"
          >
            <div
              v-for="line in scope"
              :key="line.label"
              class="flex items-start justify-between gap-4 px-3.5 py-2.5"
            >
              <dt class="flex-none text-xs leading-4 text-ink/55">{{ line.label }}</dt>
              <dd class="m-0 min-w-0 text-right text-xs leading-4 break-words text-ink">
                {{ line.value }}
              </dd>
            </div>
          </dl>

          <p class="m-0 text-[11px] leading-4 text-ink/55">{{ EXPORT_CAVEAT }}</p>

          <!-- Empty is not a failure, and saying which is the point: a file with a header
               row and nothing under it is a real answer about a narrowed view. -->
          <p
            v-if="empty"
            class="m-0 flex items-start gap-2 rounded-(--idenzy-radius-small) bg-ink/4 p-3 text-[11px] leading-4 text-ink/70 ring-1 ring-ink/6 ring-inset"
          >
            <Icon
              aria-hidden="true"
              class="mt-px flex-none text-sm text-warning"
              name="material-symbols:error-outline"
            />
            <span>
              Nothing matches this view, so the file would hold its header row and no
              entries. That is an answer about the filters rather than about the record:
              widen the period or clear a filter to take something away.
            </span>
          </p>
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
          <v-btn
            :disabled="empty"
            class="text-xs font-medium"
            color="primary"
            prepend-icon="material-symbols:download"
            size="small"
            variant="flat"
            @click="emit('confirm')"
          >
            Download CSV
          </v-btn>
        </footer>
      </div>
    </v-card>
  </v-dialog>
</template>

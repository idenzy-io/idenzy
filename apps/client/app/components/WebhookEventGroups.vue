<script setup lang="ts">
/**
 * The events, as an accordion of their groups. A group's header says what the group is and
 * how many of its events are chosen, and opens to the events themselves. Any number can be
 * open at once and the first starts open, so the common case, a few events from one group, is
 * on the dialog's first screen, and a folded group still says what is chosen in it.
 *
 * The group's own checkbox takes or leaves the whole group, and reads as mixed while only
 * some of it is chosen. The fold is a grid row going from one fraction to none, the way
 * `LayerCard` folds, so nothing is measured.
 *
 * An event nothing emits yet says so beside its name. Six of the thirteen are in that state, and
 * before this the dialog offered all of them as equals: a subscription that saves and then never
 * delivers is indistinguishable from a receiver that is broken, and the customer has no way to tell
 * which. It stays choosable, because it starts working the day the emitter lands.
 */
import {
  EVENT_GROUP_LABELS,
  EVENT_GROUP_NOTES,
  EVENT_GROUPS,
  type EventGroup,
  eventIsSent,
  eventsIn,
  groupSelection,
  toggleEvent,
  toggleGroup,
} from "~/utils/webhooks";

const chosen = defineModel<string[]>({ required: true });

const baseId = useId();
const open = ref<EventGroup[]>(EVENT_GROUPS.slice(0, 1));

function isOpen(group: EventGroup): boolean {
  return open.value.includes(group);
}

function flip(group: EventGroup) {
  open.value = isOpen(group)
    ? open.value.filter((entry) => entry !== group)
    : [...open.value, group];
}
</script>

<template>
  <div
    class="divide-y divide-ink/6 overflow-hidden rounded-(--idenzy-radius-small) bg-ink/4 ring-1 ring-ink/6 ring-inset"
  >
    <section v-for="group in EVENT_GROUPS" :key="group">
      <div class="flex items-center gap-1 py-1.5 pr-2 pl-2">
        <v-checkbox-btn
          :aria-label="`Every ${EVENT_GROUP_LABELS[group].toLowerCase()} event`"
          :indeterminate="groupSelection(group, chosen).state === 'some'"
          :model-value="groupSelection(group, chosen).state === 'all'"
          class="flex-none"
          color="primary"
          density="compact"
          @update:model-value="chosen = toggleGroup(group, chosen)"
        />
        <button
          :aria-controls="`${baseId}-${group}`"
          :aria-expanded="isOpen(group)"
          class="group flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-(--idenzy-radius-x-small) py-1 pr-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          type="button"
          @click="flip(group)"
        >
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="text-xs font-medium text-ink">{{ EVENT_GROUP_LABELS[group] }}</span>
            <span class="truncate text-[11px] leading-4 text-ink/55">
              {{ EVENT_GROUP_NOTES[group] }}
            </span>
          </span>
          <span
            :class="groupSelection(group, chosen).chosen > 0 ? 'text-ink/75' : 'text-ink/45'"
            class="flex-none font-mono text-[11px] tabular-nums"
          >
            {{ groupSelection(group, chosen).chosen }}/{{ groupSelection(group, chosen).total }}
          </span>
          <Icon
            :class="isOpen(group) ? 'rotate-180' : ''"
            aria-hidden="true"
            class="flex-none text-lg text-ink/50 transition-transform duration-200 group-hover:text-ink"
            name="material-symbols:keyboard-arrow-down"
          />
        </button>
      </div>

      <div
        :id="`${baseId}-${group}`"
        :class="isOpen(group) ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
        class="grid transition-[grid-template-rows] duration-200 ease-out"
      >
        <div :inert="!isOpen(group)" class="min-h-0 overflow-hidden">
          <ul class="m-0 flex list-none flex-col gap-1 border-t border-ink/6 bg-surface/40 p-0 py-2 pr-3 pl-2">
            <li v-for="event in eventsIn(group)" :key="event.id">
              <label class="flex cursor-pointer items-start gap-1">
                <v-checkbox-btn
                  :model-value="chosen.includes(event.id)"
                  class="-mt-1 flex-none"
                  color="primary"
                  density="compact"
                  @update:model-value="chosen = toggleEvent(event.id, chosen)"
                />
                <span class="flex min-w-0 flex-col gap-0.5 pt-px">
                  <span class="flex flex-wrap items-center gap-1.5">
                    <span class="font-mono text-[11px] text-ink">{{ event.id }}</span>
                    <Tag v-if="!eventIsSent(event.id)" label="Not sent yet" tone="warning" />
                  </span>
                  <span class="text-[11px] leading-4 text-ink/55">{{ event.note }}</span>
                </span>
              </label>
            </li>
          </ul>
        </div>
      </div>
    </section>
  </div>
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

<script setup lang="ts">
/**
 * Takes a payment method off the account.
 *
 * Two things have to be said before it goes, and neither is obvious from the row. Removing
 * the default promotes another one, so the account is never left holding methods and no
 * default, and the dialog names the one that takes over: an unattended charge lands
 * somewhere, and the reader should know where before rather than after. And the last
 * method cannot go while an automatic rule is armed, because that would leave a rule that
 * silently cannot fire, which is worse than one plainly switched off.
 *
 * A refusal is stated with the way out rather than shown as a disabled button with no
 * explanation (notes/settings.md, on unexplained disabled controls).
 */
import {
  cardLabel,
  METHOD_REMOVAL_ISSUE_LABELS,
  type MethodRemovalIssue,
  type PaymentMethod,
} from "~/utils/billing";

const props = defineProps<{
  method: PaymentMethod;
  /** Why it cannot be removed, or null. */
  issue: MethodRemovalIssue | null;
  /** How many would be left, so the consequence has a size. */
  remaining: number;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [];
}>();

const titleId = `${useId()}-title`;

const allowed = computed(() => props.issue === null);
</script>

<template>
  <v-dialog v-model="open" :persistent="busy" max-width="480">
    <v-card :aria-labelledby="titleId" border flat role="dialog">
      <div class="flex flex-col gap-5 p-5">
        <header class="flex flex-col gap-1">
          <h2 :id="titleId" class="m-0 text-sm font-medium text-ink">
            Remove {{ cardLabel(method).toLowerCase() }}?
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            The method is removed at our payment provider as well. Nothing already charged
            is affected and no invoice changes.
          </p>
        </header>

        <p
          v-if="!allowed && issue"
          class="m-0 flex items-start gap-2 rounded-(--idenzy-radius-small) border border-warning/40 bg-warning/8 p-3 text-[11px] leading-4 text-warning"
        >
          <Icon
            aria-hidden="true"
            class="mt-0.5 flex-none text-sm"
            name="material-symbols:warning-outline"
          />
          <span>{{ METHOD_REMOVAL_ISSUE_LABELS[issue] }}</span>
        </p>

        <p
          v-else-if="method.isDefault && remaining > 0"
          class="m-0 flex items-start gap-2 rounded-(--idenzy-radius-small) bg-ink/4 ring-1 ring-ink/6 ring-inset p-3 text-[11px] leading-4 text-ink/70"
        >
          <Icon
            aria-hidden="true"
            class="mt-0.5 flex-none text-sm text-ink/50"
            name="material-symbols:swap-horiz"
          />
          <span>
            This is the default, so another method becomes the default in the same change.
            There is never a moment with two and never one with none.
          </span>
        </p>

        <p
          v-else-if="remaining === 0"
          class="m-0 flex items-start gap-2 rounded-(--idenzy-radius-small) bg-ink/4 ring-1 ring-ink/6 ring-inset p-3 text-[11px] leading-4 text-ink/70"
        >
          <Icon
            aria-hidden="true"
            class="mt-0.5 flex-none text-sm text-ink/50"
            name="material-symbols:info-outline"
          />
          <span>
            It is the last one. Credit cannot be added by hand or automatically until
            another is added, and no sign-in is refused for want of one.
          </span>
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
            Keep it
          </v-btn>
          <v-btn
            :disabled="!allowed || busy"
            :loading="busy"
            class="text-xs font-medium"
            color="error"
            size="small"
            variant="flat"
            @click="emit('confirm')"
          >
            Remove method
          </v-btn>
        </footer>
      </div>
    </v-card>
  </v-dialog>
</template>

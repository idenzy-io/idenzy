<script setup lang="ts">
/**
 * The review before the dashboard's second-factor requirement is turned on or off.
 *
 * A switch that wrote itself would be a switch whose consequence is a number nobody saw:
 * the people it affects are exactly the ones who have not enrolled, and they are named
 * here because they are who a support ticket will be about. The note draws this control
 * as `[Review change]` rather than a bare toggle for that reason.
 *
 * What it must not do is promise the transition. Turning the requirement on records it and
 * nothing enforces it yet, because the enrolment step inside sign-in is not built, so the
 * dialog says that rather than describing a gate that would meet somebody at their next
 * sign-in. A requirement that reads as enforced while it is not is the note's own P1.
 */
import type { Member } from "~/utils/members";

const props = defineProps<{
  /** Whether it is on now. The dialog asks about the other state. */
  required: boolean;
  /** Who holds no second factor, by name, because they are who this lands on. */
  withoutMfa: readonly Member[];
  total: number;
  /** Whether the enrolment step inside sign-in exists. It does not. */
  enforced: boolean;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [required: boolean];
}>();

const titleId = `${useId()}-title`;

const turningOn = computed(() => !props.required);
const names = computed(() => props.withoutMfa.map((member) => member.name).join(", "));
</script>

<template>
  <v-dialog v-model="open" :persistent="busy" max-width="520">
    <v-card :aria-labelledby="titleId" border flat role="dialog">
      <div class="flex flex-col gap-5 p-5">
        <header class="flex flex-col gap-1">
          <h2 :id="titleId" class="m-0 text-sm font-medium text-ink">
            {{ turningOn ? "Require a second factor?" : "Stop requiring a second factor?" }}
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            It applies to everybody on this organisation's team, whatever their role. A
            dashboard account holds the keys to every project underneath it.
          </p>
        </header>

        <div class="divide-y divide-line">
          <SettingRow
            :description="
              turningOn
                ? 'Everybody signing in to this dashboard would be expected to hold one.'
                : 'A password alone would be enough for everybody on the team again.'
            "
            :fixed="`${total} ${total === 1 ? 'member' : 'members'}`"
            label="Who it covers"
          />

          <SettingRow
            v-if="withoutMfa.length > 0"
            :description="
              turningOn
                ? `${names} ${withoutMfa.length === 1 ? 'holds' : 'hold'} no second factor today. Nobody is locked out by this change: what it does is record the requirement.`
                : `${names} ${withoutMfa.length === 1 ? 'has' : 'have'} none enrolled, and nothing will ask them for one.`
            "
            :fixed="`${withoutMfa.length} of ${total}`"
            label="Who has not enrolled"
          />

          <SettingRow
            v-else
            description="Everybody on the team already holds one, so turning it on changes nothing today and keeps it that way for whoever joins next."
            fixed="Everybody"
            label="Who has enrolled"
          />
        </div>

        <!-- The honest half. Recording a requirement and enforcing one are different
             things, and only the first of them is built. -->
        <p
          v-if="turningOn && !enforced"
          class="m-0 flex items-start gap-2 rounded-(--idenzy-radius-small) border border-warning/40 bg-warning/8 p-3 text-[11px] leading-4 text-warning"
        >
          <Icon
            aria-hidden="true"
            class="mt-0.5 flex-none text-sm"
            name="material-symbols:warning-outline"
          />
          <span>
            Nothing enforces this yet. The enrolment step inside sign-in is not built, so a
            member without a factor can still sign in and the requirement is a note on this
            screen until it is. It is recorded so the policy is not lost, and so the
            members list can say who it would affect.
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
            Cancel
          </v-btn>
          <v-btn
            :loading="busy"
            class="text-xs font-medium"
            :color="turningOn ? 'primary' : 'error'"
            size="small"
            :variant="turningOn ? 'flat' : 'flat'"
            @click="emit('confirm', turningOn)"
          >
            {{ turningOn ? "Require it" : "Stop requiring it" }}
          </v-btn>
        </footer>
      </div>
    </v-card>
  </v-dialog>
</template>

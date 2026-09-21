<script setup lang="ts">
/**
 * The first step of adding a provider: which one. Eighteen adapters is more than a grid
 * of paragraphs can carry, so each card is a mark, a name and one short line saying
 * whether it can be picked, and a search box sits above them.
 *
 * What a provider asserts about an address is deliberately not here. It is the field that
 * decides whether a sign-in may join an account somebody already has, and it belongs
 * where the reader has made a choice and can act on it, which is the step after this one.
 * Repeating it eighteen times over turns the way in into adapter documentation.
 *
 * A provider already on the project is shown and cannot be picked, rather than left out:
 * somebody typing "google" into a search box and getting nothing back reads that as "not
 * supported". The generic OIDC connector is shown for the same reason, and says "not yet"
 * rather than nothing at all.
 */
import { PROVIDERS, type ProviderName } from "~/utils/providers";

const props = defineProps<{
  /** Already configured on this project, so shown as such rather than offered. */
  configured: readonly ProviderName[];
}>();

const selected = defineModel<ProviderName | null>({ required: true });

const query = ref("");

/* Cleared with the choice, so reopening the step does not start half filtered. */
watch(selected, (value) => {
  if (value === null) query.value = "";
});

type Availability = "open" | "configured" | "unavailable";

interface Offer {
  id: ProviderName;
  label: string;
  icon: string;
  monochrome: boolean;
  tint?: string;
  availability: Availability;
  /** The short line under the name: what picking this card would do, or why it cannot. */
  note: string;
}

const AVAILABILITY_NOTES: Record<Availability, string> = {
  open: "",
  configured: "Already on this project",
  unavailable: "Enterprise SSO, not yet",
};

const offers = computed<Offer[]>(() =>
  PROVIDERS.map((provider) => {
    const availability: Availability = !provider.available
      ? "unavailable"
      : props.configured.includes(provider.id)
        ? "configured"
        : "open";
    return {
      id: provider.id,
      label: provider.label,
      icon: provider.icon,
      monochrome: provider.monochrome,
      ...(provider.tint === undefined ? {} : { tint: provider.tint }),
      availability,
      note:
        AVAILABILITY_NOTES[availability] ||
        (provider.protocol === "oidc" ? "OpenID Connect" : "OAuth 2.0"),
    };
  }),
);

/* Matched on the name alone. Searching a catalogue of marks is looking for one you can
   already picture, and a search that also read the notes would answer "oauth" with ten. */
const shown = computed(() => {
  const text = query.value.trim().toLowerCase();
  if (text === "") return offers.value;
  return offers.value.filter((offer) => offer.label.toLowerCase().includes(text));
});

const openCount = computed(
  () => offers.value.filter((offer) => offer.availability === "open").length,
);
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <SearchField
        v-model="query"
        label="Search providers"
        placeholder="Search providers"
        class="w-full sm:w-64"
      />
      <p class="m-0 text-[11px] text-ink/50">
        {{ openCount }} available &middot; {{ configured.length }} already set up
      </p>
    </div>

    <div
      v-if="shown.length > 0"
      aria-label="Provider"
      class="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3"
      role="radiogroup"
    >
      <component
        :is="offer.availability === 'open' ? 'button' : 'div'"
        v-for="offer in shown"
        :key="offer.id"
        :aria-checked="offer.availability === 'open' ? selected === offer.id : undefined"
        :class="[
          offer.availability !== 'open' ? 'border-dashed border-line opacity-55' : '',
          offer.availability === 'open' && selected === offer.id
            ? 'border-primary bg-primary/4 ring-1 ring-primary'
            : '',
          offer.availability === 'open' && selected !== offer.id
            ? 'border-line hover:border-ink/25 hover:bg-ink/2'
            : '',
        ]"
        :role="offer.availability === 'open' ? 'radio' : undefined"
        :type="offer.availability === 'open' ? 'button' : undefined"
        class="flex items-center gap-3 rounded-(--idenzy-radius) border p-3 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        @click="offer.availability === 'open' && (selected = offer.id)"
      >
        <!-- The mark sits centred in a box of its own: the logos are not the same width,
             and a flex row starting at each mark's own edge puts every name at a
             different x. -->
        <span aria-hidden="true" class="flex size-7 flex-none items-center justify-center text-ink">
          <Icon
            :class="[offer.monochrome ? '[.v-theme--dark_&]:invert' : '', offer.tint ?? '']"
            :name="offer.icon"
            class="text-[24px]"
          />
        </span>
        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="truncate text-sm leading-5 font-medium text-ink">{{ offer.label }}</span>
          <span class="truncate text-[11px] leading-4 text-ink/50">{{ offer.note }}</span>
        </span>
        <span
          v-if="offer.availability === 'open'"
          :class="selected === offer.id ? 'border-primary bg-primary' : 'border-ink/25'"
          aria-hidden="true"
          class="flex size-4 flex-none items-center justify-center rounded-full border transition-colors duration-150"
        >
          <span v-if="selected === offer.id" class="size-1.5 rounded-full bg-on-primary" />
        </span>
        <Icon
          v-else
          :name="
            offer.availability === 'configured'
              ? 'material-symbols:check-circle-outline'
              : 'material-symbols:schedule-outline'
          "
          aria-hidden="true"
          class="flex-none text-base text-ink/35"
        />
      </component>
    </div>

    <p v-else class="m-0 px-1 py-8 text-center text-xs text-ink/50">
      No provider here is called &ldquo;{{ query.trim() }}&rdquo;. Any compliant issuer of your
      own is the generic OIDC connector, which ships with enterprise SSO.
    </p>
  </div>
</template>

<style scoped>
/* The search sits in a dialog's own rhythm rather than a toolbar's, so it is the height
   of the small controls beside it. */
</style>

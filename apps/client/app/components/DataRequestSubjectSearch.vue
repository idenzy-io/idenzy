<script setup lang="ts">
/**
 * Finding the account a request is about: type part of a name, an address, a phone or an
 * id, pick from what matches, and see the account whole before it is used. Seeing it is
 * the explicit confirmation the note asks for, where the old field matched an exact string
 * the reader had to know already (notes/data-requests.md P2).
 *
 * It never decides that nobody matches. `noMatchLabel` offers that as a step of its own,
 * because a request about somebody the search cannot place is still one to answer.
 */
import { searchSubjects } from "~/utils/data-requests";
import { formatDate } from "~/utils/time";
import type { ProjectUser } from "~/utils/users";

const props = withDefaults(
  defineProps<{
    users: readonly ProjectUser[];
    /** The field's id, so a label outside reaches it. */
    inputId: string;
    error?: boolean;
    disabled?: boolean;
    /** Offered under the results: "Record them as not matched". */
    noMatchLabel?: string;
  }>(),
  { error: false, disabled: false, noMatchLabel: "" },
);

const selected = defineModel<string | null>({ required: true });
const query = defineModel<string>("query", { default: "" });

const emit = defineEmits<{
  noMatch: [];
}>();

const chosen = computed(() => props.users.find((user) => user.id === selected.value) ?? null);
const matches = computed(() => searchSubjects(props.users, query.value));
const searched = computed(() => query.value.trim().length >= 2);
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- The account, once picked, drawn whole: the reader confirms a person, not a string. -->
    <div
      v-if="chosen"
      class="flex items-start gap-3 rounded-(--idenzy-radius-small) bg-ink/4 px-3 py-2.5 ring-1 ring-ink/6 ring-inset"
    >
      <div class="flex min-w-0 flex-1 flex-col gap-1.5">
        <UserIdentity :user="chosen" />
        <p class="m-0 flex flex-wrap gap-x-2 text-[11px] leading-4 text-ink/55">
          <span class="font-mono">{{ chosen.id }}</span>
          <span>Joined {{ formatDate(chosen.createdAt) }}</span>
        </p>
      </div>
      <v-btn
        :disabled="disabled"
        class="flex-none text-xs font-medium"
        color="neutral"
        size="small"
        variant="text"
        @click="selected = null"
      >
        Change
      </v-btn>
    </div>

    <template v-else>
      <v-text-field
        :id="inputId"
        v-model="query"
        :disabled="disabled"
        :error="error"
        autocomplete="off"
        hide-details
        placeholder="Name, email, phone or user id"
        prepend-inner-icon="material-symbols:person-search-outline"
        spellcheck="false"
        variant="filled"
      />

      <ul
        v-if="searched && matches.length > 0"
        aria-label="Matching accounts"
        class="m-0 flex list-none flex-col divide-y divide-line overflow-hidden rounded-(--idenzy-radius-small) bg-ink/4 p-0 ring-1 ring-ink/6 ring-inset"
      >
        <li v-for="user in matches" :key="user.id">
          <button
            :disabled="disabled"
            class="flex w-full cursor-pointer items-center px-3 py-2 text-left transition-colors duration-150 hover:bg-ink/4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
            type="button"
            @click="selected = user.id"
          >
            <UserIdentity :user="user" />
          </button>
        </li>
      </ul>

      <div
        v-if="searched && (matches.length === 0 || noMatchLabel)"
        class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
      >
        <p class="m-0 text-[11px] leading-4 text-ink/55">
          {{ matches.length === 0 ? "No account on this project matches." : "Not one of these?" }}
        </p>
        <button
          v-if="noMatchLabel"
          :disabled="disabled"
          class="text-xs font-medium text-ink/70 transition-colors duration-150 hover:text-ink"
          type="button"
          @click="emit('noMatch')"
        >
          {{ noMatchLabel }}
        </button>
      </div>
    </template>
  </div>
</template>

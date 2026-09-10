<script setup lang="ts">
/**
 * What a signal actually observed, on one line, with the figures set in the mono face so
 * a column of them is read against itself.
 *
 * A branch per kind rather than one sentence with holes in it, because the facts are not
 * the same shape: a hop has two ends and a speed, a corpus hit has one number and a place
 * it was offered. The line the branches build says the same thing `describeEvidence` does,
 * and that sentence is what the export writes and what a screen reader is handed here, so
 * the two cannot come to disagree about what a row said.
 *
 * Countries are named, with the flag as decoration beside them. The code alone would put
 * "DE to BR" in front of somebody deciding whether to sign an account out.
 *
 * Named for the line rather than for the type it draws, because `SignalEvidence` is the
 * type in `utils/security.ts` and a component of the same name would have two things in
 * one file reading as one thing.
 */

import { BREACH_POINT_LABELS, describeEvidence, type SignalEvidence } from "~/utils/security";
import { countryFlag, countryName } from "~/utils/sessions";

const props = defineProps<{
  evidence: SignalEvidence;
}>();

/** The one sentence, for the screen reader and the tooltip. */
const spoken = computed(() => describeEvidence(props.evidence));

const COUNT = new Intl.NumberFormat("en");

function figure(value: number): string {
  return COUNT.format(value);
}

function place(code: string): string {
  return countryName(code) ?? code;
}
</script>

<template>
  <p :aria-label="spoken" class="m-0 flex flex-wrap items-center gap-x-1.5 text-xs leading-5 text-ink/60">
    <template v-if="evidence.kind === 'breached_password'">
      <span>Seen</span>
      <span class="font-mono text-ink/80 tabular-nums">{{ figure(evidence.corpusCount) }}</span>
      <span>{{ evidence.corpusCount === 1 ? "time" : "times" }} in the corpus,</span>
      <span>offered {{ BREACH_POINT_LABELS[evidence.at] }}</span>
    </template>

    <template v-else-if="evidence.kind === 'impossible_travel'">
      <span aria-hidden="true">{{ countryFlag(evidence.from) }}</span>
      <span class="text-ink/80">{{ place(evidence.from) }}</span>
      <Icon aria-hidden="true" class="text-sm" name="material-symbols:arrow-forward" />
      <span aria-hidden="true">{{ countryFlag(evidence.to) }}</span>
      <span class="text-ink/80">{{ place(evidence.to) }}</span>
      <span class="text-ink/35">&middot;</span>
      <span class="font-mono tabular-nums">{{ figure(evidence.kilometres) }} km</span>
      <span>in</span>
      <span class="font-mono tabular-nums">{{ evidence.minutes }} min</span>
      <span class="text-ink/35">&middot;</span>
      <span class="font-mono text-warning tabular-nums">
        {{ figure(evidence.impliedKmh) }} km/h
      </span>
    </template>

    <template v-else-if="evidence.kind === 'new_country'">
      <span aria-hidden="true">{{ countryFlag(evidence.country) }}</span>
      <span class="text-ink/80">{{ place(evidence.country) }}</span>
      <span v-if="evidence.countriesBefore === 0">
        &middot; the first this account has signed in from
      </span>
      <span v-else>
        &middot; after
        <span class="font-mono tabular-nums">{{ evidence.countriesBefore }}</span>
        {{ evidence.countriesBefore === 1 ? "other" : "others" }}
      </span>
    </template>

    <template v-else-if="evidence.kind === 'credential_stuffing'">
      <span class="font-mono text-ink/80">{{ evidence.ip }}</span>
      <span class="text-ink/35">&middot;</span>
      <span class="font-mono tabular-nums">{{ figure(evidence.refusals) }}</span>
      <span>refusals across</span>
      <span class="font-mono tabular-nums">{{ figure(evidence.accountsTried) }}</span>
      <span>accounts in</span>
      <span class="font-mono tabular-nums">{{ evidence.minutes }} min</span>
    </template>

    <template v-else-if="evidence.kind === 'token_reuse'">
      <span class="font-mono tabular-nums">{{ evidence.sessionsRevoked }}</span>
      <span>{{ evidence.sessionsRevoked === 1 ? "session" : "sessions" }} in the family,</span>
      <span class="text-error">all revoked</span>
    </template>

    <template v-else>
      <span class="font-mono text-ink/80">{{ evidence.prefix }}</span>
      <span class="text-ink/35">&middot;</span>
      <span class="font-mono tabular-nums">{{ figure(evidence.sends) }} sends</span>
      <span>for</span>
      <span class="font-mono tabular-nums">{{ evidence.verified }}</span>
      <span>{{ evidence.verified === 1 ? "code" : "codes" }} entered</span>
    </template>
  </p>
</template>

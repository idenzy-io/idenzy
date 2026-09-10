<script setup lang="ts">
/**
 * The payload a token would carry for one user, as the issuer would write it: the claims
 * we assemble first and dimmed, because a template cannot touch them, then the custom
 * ones in full ink with a mark in the margin. It is drawn line by line rather than as
 * one JSON string so the two kinds can look different, which is the whole reason the
 * preview exists: the reader should see at a glance which part of the token is theirs.
 *
 * When a required claim resolves to nothing there is no token, and the preview says so
 * in place of pretending: the payload dims behind a refusal that names the claim, with
 * the error code the SDK would report.
 */
import type { RenderedTemplate } from "~/utils/claims";

const props = defineProps<{
  assembled: Readonly<Record<string, unknown>>;
  rendered: RenderedTemplate;
}>();

interface Line {
  key: string;
  text: string;
  custom: boolean;
}

/** The lines between the braces. A value is JSON, and an array of one value stays on a line. */
const lines = computed<Line[]>(() => {
  const assembled = Object.entries(props.assembled).map(([key, value]) => ({
    key,
    text: `"${key}": ${JSON.stringify(value)}`,
    custom: false,
  }));
  const custom = props.rendered.present.map((claim) => ({
    key: claim.name,
    text: `"${claim.name}": ${JSON.stringify(claim.value)}`,
    custom: true,
  }));
  const all = [...assembled, ...custom];
  return all.map((line, index) => ({
    ...line,
    text: index < all.length - 1 ? `${line.text},` : line.text,
  }));
});

const refused = computed(() => props.rendered.refusedBy);
</script>

<template>
  <div class="relative">
    <pre
      :aria-hidden="refused !== null || undefined"
      :class="refused ? 'opacity-30' : ''"
      class="m-0 overflow-x-auto px-4 py-3 font-mono text-[11px] leading-5 text-ink transition-opacity duration-200"
    ><code>{
<span
        v-for="line in lines"
        :key="line.key"
        :class="line.custom ? 'claim-line--custom text-ink' : 'text-ink/45'"
        class="claim-line block pl-4"
      >{{ line.text }}</span>}</code></pre>

    <div
      v-if="refused"
      class="absolute inset-x-4 top-1/2 -translate-y-1/2 rounded-(--idenzy-radius-small) border border-error/40 bg-surface px-4 py-3 shadow-sm"
      role="status"
    >
      <p class="m-0 flex items-center gap-1.5 text-xs font-medium text-error">
        <Icon aria-hidden="true" class="text-base" name="material-symbols:block" />
        No token: this user could not sign in
      </p>
      <p class="m-0 mt-1 text-[11px] leading-4 text-ink/70">
        <span class="font-mono text-ink/85">{{ refused.name.trim() || "(unnamed)" }}</span> is
        required and there is nothing to carry. The sign-in answers
        <span class="font-mono text-ink/85">claim_template_unsatisfied</span>, and the claim's
        name reaches your logs and never the response.
      </p>
    </div>
  </div>
</template>

<style scoped>
/* The mark in the margin: a short bar in the accent, on the line's own left edge. */
.claim-line {
  position: relative;
}

.claim-line--custom::before {
  content: "";
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 0;
  width: 2px;
  border-radius: 1px;
  background: rgb(var(--v-theme-primary));
}
</style>

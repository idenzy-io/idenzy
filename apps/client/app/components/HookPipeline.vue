<script setup lang="ts">
/**
 * The sign-in path with the hook points marked, drawn as one rail so the order is a thing
 * you read rather than a thing you assemble.
 *
 * The order is the whole content, and one step of it is worth the diagram on its own: the
 * second factor is proved *before* any hook runs. `AuthFlow` consults the MFA gate after
 * `verify` and before the hooks, so a `before-sign-in` hook never sees a half-authenticated
 * user and cannot be used to let one past a challenge. Customers ask for that guarantee and
 * are usually surprised it is already there.
 *
 * A stage that is ours is a dot. A stage that is theirs is a node, filled where the hook is
 * live and outlined where it is not, so a glance says which of the three points on this path
 * currently has somebody else's HTTP call in it.
 */
import { HOOK_ICONS, HOOK_LABELS, type HookConfig, type HookType, isHookLive } from "~/utils/hooks";

const props = defineProps<{
  hooks: readonly HookConfig[];
}>();

interface Stage {
  id: string;
  label: string;
  note: string;
  /** Present where the stage is a hook rather than something of ours. */
  hook?: HookType;
}

const STAGES: readonly Stage[] = [
  {
    id: "verify",
    label: "The credential is verified",
    note: "A password, a passkey assertion, a one-time code, an OAuth exchange. Whatever the flow was.",
  },
  {
    id: "before_sign_up",
    label: HOOK_LABELS.before_sign_up,
    note: "On a sign-up only, before the account row exists. Refusing here creates nobody.",
    hook: "before_sign_up",
  },
  {
    id: "mfa",
    label: "The second factor is proved",
    note: "When one is owed. It runs before any hook, so a hook is never handed a half-authenticated user and cannot wave one past a challenge.",
  },
  {
    id: "before_sign_in",
    label: HOOK_LABELS.before_sign_in,
    note: "Everything is proved and nothing has been issued. The last point where a sign-in can still be stopped.",
    hook: "before_sign_in",
  },
  {
    id: "session",
    label: "The session is created",
    note: "The refresh token exists from here. After this point a refusal is a revocation rather than a refusal.",
  },
  {
    id: "claims",
    label: HOOK_LABELS.customize_claims,
    note: "While the access token is minted, after the project's claim template has been applied.",
    hook: "customize_claims",
  },
  {
    id: "audit",
    label: "The entry is written",
    note: "Enqueued to the outbox in the same transaction, and relayed into the chain seconds later.",
  },
];

const liveOf = computed(() => {
  const map = new Map<HookType, boolean>();
  for (const hook of props.hooks) map.set(hook.type, isHookLive(hook));
  return map;
});

function isLive(type: HookType): boolean {
  return liveOf.value.get(type) === true;
}
</script>

<template>
  <ol class="m-0 flex list-none flex-col p-0">
    <li v-for="(stage, index) in STAGES" :key="stage.id" class="flex gap-3">
      <!-- The rail: a mark, and the line down to the next one. The line is on the item
           rather than between them so the last stage simply has none. -->
      <div class="flex flex-none flex-col items-center">
        <span
          v-if="stage.hook"
          :class="
            isLive(stage.hook)
              ? 'border-primary bg-primary/12 text-primary'
              : 'border-dashed border-line text-ink/35'
          "
          aria-hidden="true"
          class="flex size-7 items-center justify-center rounded-(--idenzy-radius-x-small) border"
        >
          <Icon :name="HOOK_ICONS[stage.hook]" class="text-sm" />
        </span>
        <span
          v-else
          aria-hidden="true"
          class="mt-2 flex size-3 items-center justify-center rounded-full border border-line bg-canvas"
        >
          <span class="size-1 rounded-full bg-ink/40" />
        </span>
        <!-- A step darker than the theme's line: this is a path being drawn rather than an
             edge between two boxes, and at the line colour it reads as a list. -->
        <span
          v-if="index < STAGES.length - 1"
          aria-hidden="true"
          class="mt-1 w-px flex-1 bg-ink/15"
        />
      </div>

      <div :class="index < STAGES.length - 1 ? 'pb-4' : ''" class="flex min-w-0 flex-col gap-0.5">
        <span class="flex flex-wrap items-center gap-2">
          <span
            :class="stage.hook ? 'text-ink' : 'text-ink/75'"
            class="text-xs font-medium"
          >
            {{ stage.label }}
          </span>
          <span
            v-if="stage.hook"
            :class="
              isLive(stage.hook)
                ? 'border-primary/40 text-primary'
                : 'border-line text-ink/45'
            "
            class="rounded-full border px-1.5 text-[10px] leading-4 font-medium"
          >
            {{ isLive(stage.hook) ? "Your service" : "Not in the path" }}
          </span>
        </span>
        <span class="text-[11px] leading-4 text-ink/55">{{ stage.note }}</span>
      </div>
    </li>
  </ol>
</template>

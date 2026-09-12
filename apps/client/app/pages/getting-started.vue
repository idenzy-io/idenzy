<script setup lang="ts">
/**
 * The first screen of an account that owns nothing yet: name a project, say where it
 * lives, and optionally tell us what it is for.
 *
 * Two steps, and the split is the design rather than decoration. The first asks the two
 * things written into rows nobody can change afterwards — a project's name is editable,
 * its region is not — and the second asks what helps us build the right thing next. On one
 * page every field would look equally binding, and the region is the only one that is.
 *
 * Nothing is written until the last button. `POST /v1/onboarding` creates the
 * organisation, its owner and the project in one transaction, so somebody who leaves
 * halfway leaves no rows and can start again from an account that is exactly as it was.
 *
 * The page is not a card. It is the only thing on the screen, and a frame around the only
 * thing on a screen is the diagnosis `notes/shared-experience.md` gives by name.
 */
import type { Step } from "~/components/Steps.vue";
import {
  EMPTY_DRAFT,
  HEARD_FROM,
  HEARD_FROM_MAX,
  type OnboardingDraft,
  OPTIONAL_NOTE,
  ORG_NAME_MAX,
  organisationNameFor,
  PROJECT_NAME_ISSUE_LABELS,
  PROJECT_NAME_MAX,
  projectNameIssue,
  REGION_QUESTION,
  REGION_WARNING,
  regionFlag,
  requiredAnswered,
  toSubmission,
  USE_CASE_MAX,
  USE_CASES,
} from "~/utils/onboarding";

definePageMeta({ layout: "onboarding" });

const store = useOnboardingStore();

// The cells we actually run, asked for once when the page opens. A region offered from a
// constant in this bundle could name a stack we are draining (notes/getting-started.md).
onMounted(() => {
  void store.loadRegions();
});

type StepId = "project" | "about";

const STEPS: readonly Step[] = [
  { id: "project", label: "Your project" },
  { id: "about", label: "About you" },
];

const step = ref<StepId>("project");
const draft = ref<OnboardingDraft>({ ...EMPTY_DRAFT });
/* Shown once somebody has left the field or tried to continue, never on a first keystroke:
   a name half typed is not yet a mistake. */
const nameTouched = ref(false);

const nameIssue = computed(() => projectNameIssue(draft.value.projectName));
const nameError = computed(() =>
  nameTouched.value && nameIssue.value !== null ? PROJECT_NAME_ISSUE_LABELS[nameIssue.value] : null,
);

/**
 * One line under the field, which is the error when there is one and the explanation
 * otherwise.
 *
 * The blueprint asks for a helper below an input, replaced by a specific error on failure
 * (notes/layout-blueprint.md). Rendered here rather than in the field's own details slot
 * because every text input in this panel carries `hide-details` — two of them stacked is
 * how the first draft of this page ended up with the error clipped behind the helper.
 */
const nameHelp = computed(
  () =>
    nameError.value ??
    "A label for this dashboard. Nobody signing in to your application ever sees it, and you can change it later.",
);

const canContinue = computed(() => requiredAnswered(draft.value.projectName, draft.value.region));

const regionOptions = computed(() =>
  store.regions.map((region) => ({
    value: region.code,
    label: region.label,
    note: `Data for this project stays under ${region.jurisdiction} law.`,
    icon: regionFlag(region.code),
  })),
);

/** What the organisation will be called, said out loud before it is created. */
const organisationName = computed(() => organisationNameFor(draft.value));

function advance() {
  nameTouched.value = true;
  if (!canContinue.value) return;
  step.value = "about";
}

async function finish() {
  const submission = toSubmission(draft.value);
  if (submission === null) {
    step.value = "project";
    nameTouched.value = true;
    return;
  }
  const created = await store.create(submission);
  if (created) await navigateTo("/");
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <header class="flex flex-col gap-2">
      <h1 class="m-0 text-2xl leading-tight font-semibold tracking-tight">
        {{ step === "project" ? "Create your first project" : "One or two optional questions" }}
      </h1>
      <p class="m-0 text-sm leading-6 opacity-70">
        {{
          step === "project"
            ? "A project is one application and the users who sign in to it. Everything in Idenzy belongs to one."
            : OPTIONAL_NOTE
        }}
      </p>
    </header>

    <Steps
      :current="step"
      :reached="canContinue ? 'about' : 'project'"
      :steps="STEPS"
      @select="step = $event as StepId"
    />

    <v-divider />

    <!-- The required half. Both answers are written into rows on submit, and only one of
         them can be changed afterwards. -->
    <form v-if="step === 'project'" class="flex flex-col gap-7" @submit.prevent="advance">
      <div class="flex flex-col gap-2">
        <label class="text-xs font-medium opacity-70" for="project-name">Project name</label>
        <v-text-field
          id="project-name"
          v-model="draft.projectName"
          :error="nameError !== null"
          :maxlength="PROJECT_NAME_MAX"
          aria-describedby="project-name-help"
          autofocus
          hide-details
          name="project-name"
          placeholder="My application"
          variant="filled"
          @blur="nameTouched = true"
        />
        <!-- One line, and the error takes its place rather than sitting under it. The
             question everybody asks about this field is who sees the name, so that is
             what it answers when there is nothing wrong (PROJECT.md 1.1). -->
        <p
          id="project-name-help"
          :class="nameError === null ? 'opacity-55' : 'text-error'"
          class="m-0 text-xs leading-5"
          role="status"
        >
          {{ nameHelp }}
        </p>
      </div>

      <div class="flex flex-col gap-3">
        <span class="text-xs font-medium opacity-70">{{ REGION_QUESTION }}</span>
        <ChoiceList
          v-model="draft.region"
          :label="REGION_QUESTION"
          :options="regionOptions"
        />
        <InfoNote icon="material-symbols:lock-outline" :text="REGION_WARNING" />
      </div>

      <div class="flex justify-end">
        <v-btn
          :disabled="!canContinue"
          append-icon="material-symbols:arrow-forward"
          color="primary"
          type="submit"
          variant="flat"
        >
          Continue
        </v-btn>
      </div>
    </form>

    <!-- The optional half. Every field here may be left alone, and the button that does
         that sits beside the one that submits rather than behind a link. -->
    <form v-else class="flex flex-col gap-7" @submit.prevent="finish">
      <div class="flex flex-col gap-2">
        <label class="text-xs font-medium opacity-70" for="use-case">
          What are you building?
        </label>
        <!-- `item-props` and `:return-object="false"`, which is how every dropdown in this
             panel draws itself: Vuetify hands the whole option to the list item, so the
             glyph and the line under the label come from the data. Returning the value
             rather than the object keeps the model a plain string whether somebody picked
             an option or typed over it, which is what the column stores either way. -->
        <v-combobox
          id="use-case"
          v-model="draft.useCase"
          :items="USE_CASES"
          :list-props="{ density: 'compact', nav: true, class: 'onboarding-menu' }"
          :maxlength="USE_CASE_MAX"
          :return-object="false"
          hide-details
          item-props
          name="use-case"
          placeholder="Pick one, or write your own"
          variant="filled"
        />
      </div>

      <div class="flex flex-col gap-2">
        <label class="text-xs font-medium opacity-70" for="heard-from">
          How did you hear about us?
        </label>
        <v-combobox
          id="heard-from"
          v-model="draft.heardFrom"
          :items="HEARD_FROM"
          :list-props="{ density: 'compact', nav: true, class: 'onboarding-menu' }"
          :maxlength="HEARD_FROM_MAX"
          :return-object="false"
          hide-details
          item-props
          name="heard-from"
          placeholder="Pick one, or write your own"
          variant="filled"
        />
      </div>

      <div class="flex flex-col gap-2">
        <label class="text-xs font-medium opacity-70" for="org-name">
          Organisation name <span class="opacity-60">(optional)</span>
        </label>
        <v-text-field
          id="org-name"
          v-model="draft.organisationName"
          :maxlength="ORG_NAME_MAX"
          :placeholder="organisationName"
          hide-details
          name="org-name"
          variant="filled"
        />
        <!-- The organisation is what the team, the wallet and the invoices belong to, and
             a reader meets the word here for the first time. Naming what it owns is
             cheaper than a glossary they would have to go and find. -->
        <p class="m-0 text-xs leading-5 opacity-55">
          Your team, your billing and your invoices belong to this. Left blank it takes the
          project's name, and you can rename it in settings.
        </p>
      </div>

      <InfoNote
        v-if="store.refusal !== null"
        icon="material-symbols:error-outline"
        :text="store.refusal"
        tone="warning"
      />

      <div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <v-btn :disabled="store.submitting" variant="text" @click="step = 'project'">
          Back
        </v-btn>
        <div class="flex flex-col gap-3 sm:flex-row">
          <v-btn :disabled="store.submitting" variant="text" @click="finish">
            Skip and create
          </v-btn>
          <v-btn :loading="store.submitting" color="primary" type="submit" variant="flat">
            Create project
          </v-btn>
        </div>
      </div>
    </form>
  </div>
</template>

<style>
/*
 * Colour only, and only on the title.
 *
 * `.v-list--nav` paints a resting item with `--idenzy-nav-inactive`, which is right in the
 * drawer — one place is current and the rest are elsewhere — and wrong in a menu of
 * answers, where nothing is elsewhere and the title is the thing being read. The subtitle
 * is left exactly as the theme draws it, so the ladder is the title's ink over the
 * subtitle's, and nothing about the size, weight or shape of the row changes.
 *
 * Unscoped because the list is teleported into an overlay Vuetify renders, so this
 * component's scope attribute never reaches it. Namespaced on a class nothing else uses,
 * which is what keeps an unscoped rule from being a global one.
 */
.onboarding-menu .v-list-item-title {
  color: rgb(var(--v-theme-on-surface));
}
</style>

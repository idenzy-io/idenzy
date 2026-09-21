/**
 * Getting started: the two answers that decide something, and the two that do not.
 *
 * A person who registers directly owns an organisation of their own, and an organisation
 * with no project is a dead end — nothing in this panel means anything without one, and
 * every screen would have to grow an empty state for a case that lasts one minute. So the
 * dashboard is not reachable until this is done, and the guard that enforces that is
 * `middleware/onboarding.global.ts`.
 *
 * Somebody who arrives by invitation never sees it. They joined an organisation that
 * already has projects, and asking them to make another would be asking them to solve a
 * problem they do not have.
 *
 * The split between the two steps is the whole design. The first asks the two things that
 * are written into rows nobody can change afterwards; the second asks what helps us build
 * the right thing next and is skippable in one click. Mixing them would make every field
 * look equally binding, and the region is the one on the page that genuinely is.
 *
 * `POST /v1/onboarding` takes the lot in one call and creates the organisation, its owner
 * and its first project in one transaction, so leaving halfway writes nothing at all.
 */

/*
 * Where a project lives.
 */

/**
 * The region question, in the words it is actually asked in.
 *
 * Not "which country are you in", which is a question about the customer, but "where
 * should this data live", which is a question about the project. A company in one country
 * routinely wants residency in another, and a form that conflated the two would answer
 * neither: the billing country is the organisation's and is asked for on the invoice.
 */
export const REGION_QUESTION = "Where should this project's data live?";

/**
 * Said out loud on the step rather than left for somebody to discover afterwards.
 *
 * A cell is pinned at creation and moving a project between them is an audited migration,
 * not a setting (PROJECT.md 4.13.5). That is the one irreversible thing on this page, and
 * a choice somebody cannot undo has to be a choice they knew they were making.
 */
export const REGION_WARNING =
  "Pinned when the project is created. Moving a project to another region later is a migration we run for you, not a setting you can change.";

/**
 * The flag beside each region, keyed on `region_cells.code`.
 *
 * Presentation and nothing more: the server sends a code and a jurisdiction, and a flag is
 * what makes a list of two place names scannable at a glance rather than read word by
 * word. Written out in full so `@nuxt/icon` bundles them — `provider: "none"` and
 * `fallbackToApi: false` mean a name assembled at runtime draws nothing at all.
 *
 * A cell we have not styled falls back to a globe rather than to an empty slot. Cells are
 * added by provisioning and not by this bundle, so a new one must render before anybody
 * gets round to picking its flag.
 */
const REGION_FLAGS: Record<string, string> = {
  us1: "circle-flags:us",
  eu1: "circle-flags:eu",
};

export const REGION_FLAG_FALLBACK = "material-symbols:public";

export function regionFlag(code: string): string {
  return REGION_FLAGS[code] ?? REGION_FLAG_FALLBACK;
}

/*
 * What the answers have to satisfy.
 */

/** The bounds the management API enforces, and nothing stricter. */
export const PROJECT_NAME_MAX = 80;
export const ORG_NAME_MAX = 120;
export const USE_CASE_MAX = 500;
export const HEARD_FROM_MAX = 200;

export type ProjectNameIssue = "empty" | "too_long";

export const PROJECT_NAME_ISSUE_LABELS: Record<ProjectNameIssue, string> = {
  empty: "A project needs a name.",
  too_long: `A name can be up to ${PROJECT_NAME_MAX} characters.`,
};

/**
 * Trimmed before it is measured, because the server trims too.
 *
 * A name that is only spaces is empty, and one that fits after trimming fits. Judging the
 * raw string would refuse a value the API would then accept, which is the kind of
 * disagreement that reads as a broken form rather than as a rule.
 */
export function projectNameIssue(value: string): ProjectNameIssue | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "empty";
  return trimmed.length > PROJECT_NAME_MAX ? "too_long" : null;
}

/** Everything the first step needs before it can hand over to the second. */
export function requiredAnswered(projectName: string, region: string | null): boolean {
  return projectNameIssue(projectName) === null && region !== null;
}

/*
 * What we ask that is not required.
 */

/**
 * The optional questions, as options rather than free text.
 *
 * A list somebody picks from is answered far more often than a box somebody has to fill,
 * and these exist to be answered. Each still allows a written answer, because the useful
 * ones are the ones nobody put on the list.
 *
 * Shaped for `item-props`, which is how every other dropdown in this panel draws its
 * options: Vuetify hands the whole object to the list item, so the glyph and the line
 * under the label are read from the option rather than reached for through a slot. A bare
 * string list renders as bare strings, which is what these were and why they did not look
 * like the rest of the dashboard.
 *
 * `value` is the title rather than a code, because it is what gets stored: the column is
 * free text either way, and a code would mean a lookup table to read a survey answer back.
 */
export interface OnboardingOption {
  /** What is stored. The same string a person typing their own answer would store. */
  value: string;
  title: string;
  /** Written out in full so @nuxt/icon bundles it. */
  prependIcon: string;
  /** Only where it earns its place. An option nobody misreads does not need explaining. */
  subtitle?: string;
}

export const USE_CASES: readonly OnboardingOption[] = [
  {
    value: "A product I am building",
    title: "A product I am building",
    subtitle: "Something of your own",
    prependIcon: "material-symbols:rocket-launch-outline",
  },
  {
    value: "A client's product",
    title: "A client's product",
    subtitle: "Agency or contract work",
    prependIcon: "material-symbols:handshake-outline",
  },
  {
    value: "Replacing another auth provider",
    title: "Replacing another auth provider",
    subtitle: "Auth0, Clerk, Firebase, Supabase",
    prependIcon: "material-symbols:swap-horiz",
  },
  {
    value: "Evaluating for my team",
    title: "Evaluating for my team",
    subtitle: "Comparing options before committing",
    prependIcon: "material-symbols:balance",
  },
  {
    value: "Learning or a side project",
    title: "Learning or a side project",
    subtitle: "No production users yet",
    prependIcon: "material-symbols:school-outline",
  },
];

/**
 * No subtitles here, and the asymmetry with the list above is deliberate. Nobody misreads
 * "a search engine", and a line of explanation under each would be furniture that makes
 * the menu taller without making a single option clearer.
 */
export const HEARD_FROM: readonly OnboardingOption[] = [
  { value: "A search engine", title: "A search engine", prependIcon: "material-symbols:search" },
  {
    value: "A friend or colleague",
    title: "A friend or colleague",
    prependIcon: "material-symbols:group-outline",
  },
  { value: "Social media", title: "Social media", prependIcon: "material-symbols:tag" },
  {
    value: "A blog post or newsletter",
    title: "A blog post or newsletter",
    prependIcon: "material-symbols:article-outline",
  },
  {
    value: "A conference or meetup",
    title: "A conference or meetup",
    prependIcon: "material-symbols:campaign-outline",
  },
];

/**
 * What the optional step's skip button is worth saying.
 *
 * Naming the consequence rather than implying one: skipping costs nothing and the project
 * is created either way. A flow that made "skip" feel like a forfeit would collect
 * answers nobody meant.
 */
export const OPTIONAL_NOTE =
  "This helps us decide what to build next. Skipping it changes nothing about your project.";

/*
 * What the whole form comes to.
 */

export interface OnboardingDraft {
  projectName: string;
  /** `region_cells.code`. Null until somebody chooses, because a default is not a choice. */
  region: string | null;
  organisationName: string;
  useCase: string;
  heardFrom: string;
}

export const EMPTY_DRAFT: OnboardingDraft = {
  projectName: "",
  region: null,
  organisationName: "",
  useCase: "",
  heardFrom: "",
};

export interface OnboardingSubmission {
  projectName: string;
  region: string;
  organisationName?: string;
  useCase?: string;
  heardFrom?: string;
}

/**
 * The draft as the API takes it: trimmed, and with the empty optionals left out entirely.
 *
 * Absent rather than empty-string, because the two mean different things one layer down.
 * A missing `useCase` stores no row at all; `""` would store a row saying somebody
 * answered nothing, which is a worse record than no record.
 */
export function toSubmission(draft: OnboardingDraft): OnboardingSubmission | null {
  const projectName = draft.projectName.trim();
  if (draft.region === null || projectNameIssue(projectName) !== null) return null;

  const optional = (value: string) => {
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  };

  return {
    projectName,
    region: draft.region,
    ...(optional(draft.organisationName) === undefined
      ? {}
      : { organisationName: optional(draft.organisationName) }),
    ...(optional(draft.useCase) === undefined ? {} : { useCase: optional(draft.useCase) }),
    ...(optional(draft.heardFrom) === undefined ? {} : { heardFrom: optional(draft.heardFrom) }),
  };
}

/**
 * What the organisation ends up called when nobody said.
 *
 * The project's name, which is the only thing on the page that describes what they are
 * doing. It is renamed from settings in one field, and a personal organisation is
 * frequently never renamed at all — so the fallback has to be something a person
 * recognises on their own dashboard rather than "Untitled".
 */
export function organisationNameFor(draft: OnboardingDraft): string {
  const given = draft.organisationName.trim();
  return given.length > 0 ? given : draft.projectName.trim();
}

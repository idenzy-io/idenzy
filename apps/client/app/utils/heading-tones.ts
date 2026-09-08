/**
 * The colours an auth screen may mark its heading with, and what each of them means.
 *
 * One map rather than one per page, for the same reason the provider list is one list:
 * two copies are only ever a chance for green to mean something different on the screen
 * next door. The meanings are the part worth keeping straight.
 *
 * `error` is a credential we read and refused; `warning` is one we could not judge at
 * all. That distinction is what the recovery screens turn on, because telling somebody
 * holding a good link that it is invalid sends them round a loop that cannot end.
 * `neutral` keeps the text it is written in and marks itself with a faint rule, which is
 * as much emphasis as an outcome nobody has to act on deserves. Unmarked and neutral is a
 * plain title, which is what a screen still waiting on the visitor gets: colour here
 * means an answer, so a screen with no answer takes none.
 *
 * Vuetify writes a custom property per theme colour, so all of these follow the theme
 * without a second set of values to keep in step.
 */
export type HeadingTone = "success" | "warning" | "error" | "neutral";

export interface HeadingToneColors {
  /** The marked words themselves. */
  text: string;
  /** The rule under them. */
  rule: string;
}

export const HEADING_TONES: Record<HeadingTone, HeadingToneColors> = {
  success: { text: "rgb(var(--v-theme-success))", rule: "rgb(var(--v-theme-success))" },
  warning: { text: "rgb(var(--v-theme-warning))", rule: "rgb(var(--v-theme-warning))" },
  error: { text: "rgb(var(--v-theme-error))", rule: "rgb(var(--v-theme-error))" },
  neutral: { text: "currentColor", rule: "rgba(var(--v-theme-on-surface), 0.25)" },
};

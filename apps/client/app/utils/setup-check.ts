/**
 * What a method screen says about whether it actually works, shared by the screens that
 * say it.
 *
 * A method can be configured correctly and still be unusable, because the things it
 * depends on are not all on its own screen: a passkey needs the CORS allowlist, a
 * password reset needs a sending domain. A blocker is a gap somebody can close from the
 * screen they are on; a check is a diagnosis, and the one that names another screen is
 * the reason this exists at all.
 *
 * The types live here rather than in either screen's utils because both screens draw
 * them with the same two components, and a second copy of the shape is a second copy of
 * the wording that goes with it.
 */

export type SetupState = "pass" | "warn" | "fail";

export interface SetupCheck {
  /** Unique within one screen's list; it is the row's key. */
  id: string;
  /** What is being checked, in the reader's words rather than the protocol's. */
  label: string;
  state: SetupState;
  /** What was found. One line, naming the value it was found on. */
  finding: string;
  /** Where it is fixed, when that is not this screen. */
  fix?: { label: string; to: string };
}

export interface SetupBlocker {
  id: string;
  title: string;
  detail: string;
  /** The words on the button that settles it, which is on this screen. */
  action: string;
}

/** The glyph and the ink for each state, so two screens cannot mark them differently. */
export const CHECK_MARKS: Record<SetupState, { icon: string; tone: string }> = {
  pass: { icon: "material-symbols:check-circle-outline", tone: "text-success" },
  warn: { icon: "material-symbols:error-outline", tone: "text-warning" },
  fail: { icon: "material-symbols:cancel-outline", tone: "text-error" },
};

/** The state written out beside the mark, because colour alone is not a state. */
export const CHECK_WORDS: Record<SetupState, string> = {
  pass: "Passing",
  warn: "Worth a look",
  fail: "Blocking",
};

/** `1 URL is` / `2 URLs are`, for a finding that has to count what it found. */
export function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en")} ${count === 1 ? one : many}`;
}

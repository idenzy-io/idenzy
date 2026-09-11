/**
 * Each project's own transactional templates, as the panel sees them.
 *
 * One row of `email_templates` per project, type and locale, unique on the three
 * together, read and written through the management API; this store is those rows with a
 * placeholder until the client exists. A project with none is the ordinary state, not an
 * empty one: every type has built-in copy behind it, so a project that has customised
 * nothing still sends a complete set of mail.
 *
 * A saved row carries a compiled `html` that the worker pool produces off the request
 * path, and a row that has not been through that step is treated as absent by the
 * renderer rather than sent as an empty mail (PROJECT.md 11.3). The panel shows that
 * window as a state of its own, because a template that looks saved and is not yet
 * sending is the one thing an operator would otherwise have no way to see.
 *
 * **Unsaved work lives here too, and that is deliberate.** A draft is held per project,
 * message and language, so switching language, walking back to the catalogue and coming
 * in again all preserve it: the editor used to reload its bodies on a language change and
 * lose whatever had been typed, which is the finding `notes/email-templates.md` opens
 * with. Holding it in the store rather than in the workspace component is what makes the
 * catalogue able to say a message has unpublished copy in it, and what stops the drafts
 * dying on a route change. They do not survive a reload; nothing is written to browser
 * storage, because a draft is a customer's unpublished copy and this panel is opened on
 * shared machines.
 */

import {
  bodiesEqual,
  type EmailTemplateType,
  startingPoint,
  type TemplateBodies,
} from "~/utils/email-templates";

export interface StoredTemplate extends TemplateBodies {
  type: EmailTemplateType;
  locale: string;
  /** Bumped on every save, and what the compiled body is cached by. */
  version: number;
  /** Who changed it last, kept for attribution and pseudonymised on erasure. */
  updatedBy: string;
  updatedAt: string;
  /**
   * False between the save and the worker compiling it. Until it flips, the renderer
   * reads the row as absent and the built-in is what goes out.
   */
  compiled: boolean;
}

/** What a save carries. The version, the author and the compile are the server's. */
export type TemplateDraft = TemplateBodies;

const PLACEHOLDER_LATENCY = 700;
const SAVE_LATENCY = 800;
/** How long the placeholder pretends the worker pool takes to compile a saved body. */
const COMPILE_LATENCY = 4000;

export const useEmailTemplatesStore = defineStore("emailTemplates", () => {
  const templates = ref<Record<string, StoredTemplate[]>>({});
  const loading = ref(true);
  const lastSaved = ref<Record<string, string>>({});

  setTimeout(() => {
    templates.value = {
      prj_personal: [],
      prj_acme: [
        {
          type: "email_otp",
          locale: "en",
          subject: "{{ otp }} is your Acme code",
          html: '<div style="padding:24px;font-family:Helvetica,Arial,sans-serif"><h1 style="font-size:20px;margin:0 0 16px">Your Acme sign-in code</h1><p style="font-size:15px;line-height:24px;color:#3f3f46">Enter this code to sign in.</p><p style="font-family:ui-monospace,Menlo,monospace;font-size:32px;letter-spacing:6px;font-weight:600">{{ otp }}</p><p style="font-size:15px;line-height:24px;color:#3f3f46">It expires in {{ expires_in }} and can be used once.</p></div>',
          text: "Your Acme sign-in code is {{ otp }}.\n\nIt expires in {{ expires_in }} and can be used once.",
          version: 4,
          updatedBy: "hasan@example.com",
          updatedAt: "2026-09-05T09:12:00.000Z",
          compiled: true,
        },
        {
          type: "email_otp",
          locale: "tr",
          subject: "{{ otp }} Acme giris kodunuz",
          html: '<div style="padding:24px;font-family:Helvetica,Arial,sans-serif"><h1 style="font-size:20px;margin:0 0 16px">Acme giris kodunuz</h1><p style="font-size:15px;line-height:24px;color:#3f3f46">Giris yapmak icin bu kodu girin.</p><p style="font-family:ui-monospace,Menlo,monospace;font-size:32px;letter-spacing:6px;font-weight:600">{{ otp }}</p><p style="font-size:15px;line-height:24px;color:#3f3f46">Kod {{ expires_in }} icinde gecerliligini yitirir.</p></div>',
          text: "Acme giris kodunuz: {{ otp }}.\n\nKod {{ expires_in }} icinde gecerliligini yitirir.",
          version: 2,
          updatedBy: "hasan@example.com",
          updatedAt: "2026-09-05T09:31:00.000Z",
          compiled: true,
        },
        {
          type: "magic_link",
          locale: "en",
          subject: "Your Acme sign-in link",
          html: '<div style="padding:24px;font-family:Helvetica,Arial,sans-serif"><h1 style="font-size:20px;margin:0 0 16px">Sign in to Acme</h1><p style="font-size:15px;line-height:24px;color:#3f3f46">Use the button below to sign in as {{ user.email }}.</p><p><a href="{{ link }}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;border-radius:8px;text-decoration:none">Sign in</a></p><p style="font-size:15px;line-height:24px;color:#3f3f46">The link expires in {{ expires_in }} and works once.</p></div>',
          text: "Sign in to Acme as {{ user.email }}:\n{{ link }}\n\nThe link expires in {{ expires_in }} and works once.",
          version: 1,
          updatedBy: "hasan@example.com",
          updatedAt: "2026-08-28T16:04:00.000Z",
          compiled: true,
        },
        {
          type: "password_reset",
          locale: "en",
          subject: "Reset your Acme password",
          html: '<div style="padding:24px;font-family:Helvetica,Arial,sans-serif"><h1 style="font-size:20px;margin:0 0 16px">Reset your password</h1><p style="font-size:15px;line-height:24px;color:#3f3f46">Choose a new password for {{ user.email }}.</p><p><a href="{{ link }}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;border-radius:8px;text-decoration:none">Reset password</a></p><p style="font-size:15px;line-height:24px;color:#3f3f46">The link expires in {{ expires_in }} and works once.</p></div>',
          text: "Choose a new password for {{ user.email }}:\n{{ link }}\n\nThe link expires in {{ expires_in }} and works once.",
          version: 2,
          updatedBy: "hasan@example.com",
          updatedAt: "2026-09-08T11:47:00.000Z",
          /* Saved a moment ago and still on the worker pool, which is the state the
             renderer reads as absent: this project is still sending our copy. */
          compiled: false,
        },
      ],
    };
    loading.value = false;
  }, PLACEHOLDER_LATENCY);

  function forProject(projectId: string): StoredTemplate[] {
    return templates.value[projectId] ?? [];
  }

  /** Every locale a project has written copy for, in the order a list shows them. */
  function localesFor(projectId: string, type: EmailTemplateType): string[] {
    return forProject(projectId)
      .filter((row) => row.type === type)
      .map((row) => row.locale)
      .sort((a, b) => a.localeCompare(b));
  }

  function find(projectId: string, type: EmailTemplateType, locale: string): StoredTemplate | null {
    return forProject(projectId).find((row) => row.type === type && row.locale === locale) ?? null;
  }

  /*
   * Unsaved copy, per project, message and language.
   *
   * Keyed as one flat map rather than nested, because every question asked of it is asked
   * with all three parts in hand and a nested shape would only add three lookups and a
   * pile of empty objects to reap.
   */
  const drafts = ref<Record<string, TemplateBodies>>({});

  const keyOf = (projectId: string, type: EmailTemplateType, locale: string) =>
    `${projectId}|${type}|${locale}`;

  /**
   * The copy a language starts from: the project's own row, or our built-in.
   *
   * This is what a draft is compared against to decide whether anything is unsaved, and
   * what the editor opens on for a language nobody has written yet. A blank page would be
   * a worse starting point than a working message somebody can edit down.
   */
  function baseline(projectId: string, type: EmailTemplateType, locale: string): TemplateBodies {
    const row = find(projectId, type, locale);
    if (row === null) return startingPoint(type);
    return { subject: row.subject, html: row.html, text: row.text };
  }

  function draftFor(
    projectId: string,
    type: EmailTemplateType,
    locale: string,
  ): TemplateBodies | null {
    return drafts.value[keyOf(projectId, type, locale)] ?? null;
  }

  /** What the editor shows: the draft where there is one, the baseline where there is not. */
  function bodiesFor(projectId: string, type: EmailTemplateType, locale: string): TemplateBodies {
    return draftFor(projectId, type, locale) ?? baseline(projectId, type, locale);
  }

  function setDraft(
    projectId: string,
    type: EmailTemplateType,
    locale: string,
    bodies: TemplateBodies,
  ) {
    drafts.value = { ...drafts.value, [keyOf(projectId, type, locale)]: { ...bodies } };
  }

  function clearDraft(projectId: string, type: EmailTemplateType, locale: string) {
    const { [keyOf(projectId, type, locale)]: _dropped, ...rest } = drafts.value;
    drafts.value = rest;
  }

  /**
   * Whether a language has work in it that is not saved.
   *
   * A draft against no stored row is always unsaved, even where it matches our built-in
   * word for word: saving it creates the project's own copy of the message, which is a
   * change whatever the bytes say. Adding a language and publishing it unedited is a real
   * thing to want, because it pins the copy against a later change to our built-in.
   */
  function isDirty(projectId: string, type: EmailTemplateType, locale: string): boolean {
    const draft = draftFor(projectId, type, locale);
    if (draft === null) return false;
    const row = find(projectId, type, locale);
    if (row === null) return true;
    return !bodiesEqual(draft, { subject: row.subject, html: row.html, text: row.text });
  }

  /** Every language of one message that has unsaved work, in the order a list shows them. */
  function dirtyLocales(projectId: string, type: EmailTemplateType): string[] {
    return draftLocales(projectId, type).filter((locale) => isDirty(projectId, type, locale));
  }

  /** Every language a draft is held for, saved or not, so a new one appears in the list. */
  function draftLocales(projectId: string, type: EmailTemplateType): string[] {
    const prefix = `${projectId}|${type}|`;
    return Object.keys(drafts.value)
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .sort((a, b) => a.localeCompare(b));
  }

  /** Messages on this project with unsaved copy in them, which the catalogue marks. */
  function typesWithDrafts(projectId: string): Set<EmailTemplateType> {
    const found = new Set<EmailTemplateType>();
    for (const key of Object.keys(drafts.value)) {
      const [project, type, locale] = key.split("|");
      if (project !== projectId || type === undefined || locale === undefined) continue;
      if (isDirty(projectId, type as EmailTemplateType, locale))
        found.add(type as EmailTemplateType);
    }
    return found;
  }

  /**
   * Writes one type and locale whole.
   *
   * Whole rather than patched, because the three bodies are one message: a subject saved
   * against a body somebody else replaced is a mail nobody wrote. The row comes back
   * uncompiled, as it does from the server, and flips once the worker pool has been past.
   */
  async function save(
    projectId: string,
    type: EmailTemplateType,
    locale: string,
    draft: TemplateDraft,
    author: string,
  ): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const existing = find(projectId, type, locale);
    const row: StoredTemplate = {
      ...draft,
      type,
      locale,
      version: (existing?.version ?? 0) + 1,
      updatedBy: author,
      updatedAt: new Date().toISOString(),
      compiled: false,
    };
    const rest = forProject(projectId).filter(
      (held) => !(held.type === type && held.locale === locale),
    );
    templates.value = { ...templates.value, [projectId]: [...rest, row] };
    lastSaved.value = { ...lastSaved.value, [projectId]: row.updatedAt };
    /* The draft has become the row, so what is held is no longer unsaved. Dropped after
       the write and not before, so a failed save leaves the reader's work where it was. */
    clearDraft(projectId, type, locale);
    setTimeout(() => markCompiled(projectId, type, locale, row.version), COMPILE_LATENCY);
  }

  /** The worker pool has been past. Keyed by version, so a later save is not overtaken. */
  function markCompiled(
    projectId: string,
    type: EmailTemplateType,
    locale: string,
    version: number,
  ) {
    const rows = forProject(projectId);
    const at = rows.findIndex(
      (row) => row.type === type && row.locale === locale && row.version === version,
    );
    if (at === -1) return;
    const next = [...rows];
    next[at] = { ...(next[at] as StoredTemplate), compiled: true };
    templates.value = { ...templates.value, [projectId]: next };
  }

  /**
   * Drops a project's copy for one type and locale, which puts the built-in back.
   *
   * Not a delete of the message: every type has copy behind it, so removing a row is
   * reverting rather than emptying, and the dialog says so in those words.
   */
  async function revert(projectId: string, type: EmailTemplateType, locale: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    clearDraft(projectId, type, locale);
    templates.value = {
      ...templates.value,
      [projectId]: forProject(projectId).filter(
        (row) => !(row.type === type && row.locale === locale),
      ),
    };
    lastSaved.value = { ...lastSaved.value, [projectId]: new Date().toISOString() };
  }

  function lastSavedAt(projectId: string): string | null {
    return lastSaved.value[projectId] ?? null;
  }

  return {
    templates,
    drafts,
    loading,
    forProject,
    localesFor,
    find,
    baseline,
    bodiesFor,
    draftFor,
    draftLocales,
    setDraft,
    clearDraft,
    isDirty,
    dirtyLocales,
    typesWithDrafts,
    save,
    revert,
    lastSavedAt,
  };
});

import { describe, expect, it } from "vitest";
import {
  ALWAYS_IN_SCOPE,
  BUILT_IN,
  bodiesEqual,
  catalogueEntry,
  DEFAULT_LOCALE,
  type EmailTemplateType,
  escapeHtml,
  hasIssues,
  LOCALE_STATUS_LABELS,
  localeChain,
  localeStatusOf,
  normalizeLocale,
  referencedVariables,
  renderPreview,
  resolve,
  sampleValues,
  scanPlaceholders,
  startingPoint,
  statusOf,
  TEMPLATE_CATALOGUE,
  TEMPLATE_STATUS_LABELS,
  type TemplateBodies,
  type TemplateVariable,
  toPlainText,
  unmatchedPlaceholders,
  VARIABLE_HELP,
  validateTemplate,
  variablesInScope,
} from "../../app/utils/email-templates";

const VALUES = sampleValues({ projectName: "Acme", expiresInSeconds: 600 });

describe("the catalogue", () => {
  it("names every type once and says what sends it", () => {
    const types = TEMPLATE_CATALOGUE.map((entry) => entry.type);
    expect(new Set(types).size).toBe(types.length);
    for (const entry of TEMPLATE_CATALOGUE) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.note.length).toBeGreaterThan(0);
      expect(entry.icon.startsWith("material-symbols:")).toBe(true);
    }
  });

  it("does not carry the SMS type, which has one field and a segment budget", () => {
    expect(TEMPLATE_CATALOGUE.some((entry) => (entry.type as string) === "sms_otp")).toBe(false);
  });

  it("gives every message the three the mailer fills in, plus its own", () => {
    for (const entry of TEMPLATE_CATALOGUE) {
      const scope = variablesInScope(entry.type);
      for (const always of ALWAYS_IN_SCOPE) expect(scope).toContain(always);
      for (const own of entry.variables) expect(scope).toContain(own);
    }
  });

  it("only claims a payload the message actually carries", () => {
    for (const entry of TEMPLATE_CATALOGUE) {
      if (entry.payload === null) continue;
      expect(entry.variables).toContain(entry.payload);
    }
  });
});

/*
 * The one that matters: our own copy has to satisfy the rules this screen enforces. A
 * built-in referencing a variable the flow does not pass would fail every send of that
 * message, and the failure is invisible until somebody cannot sign in.
 */
describe("the built-in copy", () => {
  const shipped = Object.entries(BUILT_IN) as [EmailTemplateType, TemplateBodies | undefined][];

  it("ships copy for every message a flow sends today", () => {
    const live = TEMPLATE_CATALOGUE.filter((entry) => entry.live).map((entry) => entry.type);
    for (const type of live) expect(BUILT_IN[type]).toBeDefined();
  });

  it("references nothing outside the scope of its own message", () => {
    for (const [type, bodies] of shipped) {
      if (bodies === undefined) continue;
      const scope = new Set<string>(variablesInScope(type));
      for (const field of ["subject", "html", "text"] as const) {
        for (const name of referencedVariables(bodies[field])) {
          expect({ type, field, name, inScope: scope.has(name) }).toEqual({
            type,
            field,
            name,
            inScope: true,
          });
        }
      }
    }
  });

  it("passes the checks this screen refuses a save for", () => {
    for (const [type, bodies] of shipped) {
      if (bodies === undefined) continue;
      expect({ type, issues: validateTemplate(bodies, type) }).toEqual({
        type,
        issues: { subject: [], html: [], text: [] },
      });
    }
  });

  it("carries the value each message exists for", () => {
    for (const [type, bodies] of shipped) {
      if (bodies === undefined) continue;
      const payload = catalogueEntry(type)?.payload;
      if (payload === null || payload === undefined) continue;
      const carried = [...referencedVariables(bodies.html), ...referencedVariables(bodies.text)];
      expect(carried).toContain(payload);
    }
  });

  it("keeps the ignore line off the one template that is a warning", () => {
    expect(BUILT_IN.email_change_old?.text).not.toContain("you can ignore this email");
    expect(BUILT_IN.email_verification?.text).toContain("you can ignore this email");
  });
});

describe("the template language", () => {
  it("accepts a name and a dotted path, and nothing else", () => {
    expect(referencedVariables("{{ otp }} for {{project.name}}")).toEqual(["otp", "project.name"]);
    expect(referencedVariables("{{ Otp }}")).toEqual([]);
    expect(referencedVariables("{{ 1 + 1 }}")).toEqual([]);
  });

  it("names the braced runs that are not placeholders, since those are sent as typed", () => {
    expect(unmatchedPlaceholders("{{#if user}}{{ otp }}{{/if}}")).toEqual([
      "{{#if user}}",
      "{{/if}}",
    ]);
    expect(unmatchedPlaceholders("{{ otp }} and {{ project.name }}")).toEqual([]);
  });

  it("escapes the five characters that change the meaning of markup", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});

describe("validateTemplate", () => {
  const base = { subject: "Your code", html: "<p>{{ otp }}</p>", text: "{{ otp }}" };

  it("passes a body that references only what its message carries", () => {
    expect(hasIssues(validateTemplate(base, "email_otp"))).toBe(false);
  });

  it("refuses a variable another message carries but this one does not", () => {
    const issues = validateTemplate({ ...base, html: "<p>{{ link }}</p>" }, "email_otp");
    expect(issues.html).toContain("unknown_variable");
  });

  it("flags a body missing the value the message exists for", () => {
    const issues = validateTemplate(
      { subject: "Hello", html: "<p>Hello</p>", text: "Hello" },
      "email_otp",
    );
    expect(issues.html).toContain("missing_payload");
  });

  it("accepts the payload carried in the text part alone rather than flagging both", () => {
    const issues = validateTemplate(
      { subject: "Your code", html: "<p>Hello</p>", text: "{{ otp }}" },
      "email_otp",
    );
    expect(issues.html).not.toContain("missing_payload");
  });

  it("flags braces that look like a placeholder and are not", () => {
    const issues = validateTemplate({ ...base, text: "{{#each}}{{ otp }}" }, "email_otp");
    expect(issues.text).toContain("unmatched_placeholder");
  });

  it("flags markup in a subject, which is substituted as text", () => {
    const issues = validateTemplate({ ...base, subject: "<b>{{ otp }}</b>" }, "email_otp");
    expect(issues.subject).toContain("subject_markup");
  });

  it("flags an empty field", () => {
    expect(validateTemplate({ ...base, text: "   " }, "email_otp").text).toContain("empty");
  });

  it("asks nothing of a payload for a message that carries none", () => {
    const issues = validateTemplate(
      { subject: "Signed in", html: "<p>Hello</p>", text: "Hello" },
      "new_device_signin",
    );
    expect(hasIssues(issues)).toBe(false);
  });
});

describe("locales", () => {
  it("normalizes a tag or refuses it", () => {
    expect(normalizeLocale("TR")).toBe("tr");
    expect(normalizeLocale("pt_br")).toBe("pt-BR");
    expect(normalizeLocale("english")).toBeNull();
  });

  it("looks for the region, then the language, then the default", () => {
    expect(localeChain("tr-TR")).toEqual(["tr-TR", "tr", "en"]);
    expect(localeChain("tr")).toEqual(["tr", "en"]);
    expect(localeChain("en")).toEqual(["en"]);
    expect(localeChain("nonsense")).toEqual([DEFAULT_LOCALE]);
  });
});

describe("resolve", () => {
  it("takes the project's exact language when it has one", () => {
    expect(resolve("tr-TR", ["tr-TR", "en"])).toEqual({ source: "yours", locale: "tr-TR" });
  });

  it("takes the project's language before its region", () => {
    expect(resolve("tr-TR", ["tr", "en"])).toEqual({ source: "yours", locale: "tr" });
  });

  it("takes the project's English over any built-in of ours", () => {
    expect(resolve("tr-TR", ["en"])).toEqual({ source: "yours", locale: "en" });
  });

  it("falls back to the built-in only when the project has written nothing", () => {
    expect(resolve("tr-TR", [])).toEqual({ source: "built_in", locale: "en" });
  });
});

describe("renderPreview", () => {
  it("substitutes the sample values", () => {
    expect(renderPreview("{{ otp }} for {{ project.name }}", VALUES, "text")).toBe(
      "482913 for Acme",
    );
  });

  it("escapes in the HTML body and not in the text part", () => {
    const values = { "user.email": '<b>"a"</b>' };
    expect(renderPreview("{{ user.email }}", values, "html")).toBe(
      "&lt;b&gt;&quot;a&quot;&lt;/b&gt;",
    );
    expect(renderPreview("{{ user.email }}", values, "text")).toBe('<b>"a"</b>');
  });

  it("leaves a placeholder standing where there is nothing to put there", () => {
    expect(renderPreview("{{ link }}", {}, "text")).toBe("{{ link }}");
  });

  it("writes expires_in as words rather than a count of seconds", () => {
    expect(VALUES.expires_in).toBe("10 minutes");
  });
});

describe("toPlainText", () => {
  it("keeps a link the reader would otherwise lose", () => {
    expect(toPlainText('<p>Hello <a href="https://a.example">here</a></p>')).toBe(
      "Hello here (https://a.example)",
    );
  });

  it("drops markup and collapses the whitespace it leaves behind", () => {
    expect(toPlainText("<div><p>One</p><p>Two</p></div>")).toBe("One\n\nTwo");
  });

  it("drops a script rather than reading its source out as text", () => {
    expect(toPlainText("<p>Hi</p><script>alert(1)</script>")).toBe("Hi");
  });
});

describe("startingPoint", () => {
  it("opens on our copy where we ship some", () => {
    expect(startingPoint("email_otp").subject).toBe(BUILT_IN.email_otp?.subject);
  });

  it("opens on an empty draft for a message we ship none for", () => {
    expect(startingPoint("invite").subject).toBe("");
  });

  it("hands back a copy, so an edit cannot reach the built-in", () => {
    const draft = startingPoint("email_otp");
    draft.subject = "changed";
    expect(BUILT_IN.email_otp?.subject).not.toBe("changed");
  });
});

describe("scanPlaceholders", () => {
  it("finds every braced run in order, with its offsets", () => {
    const found = scanPlaceholders("a {{ otp }} b {{ link }}");
    expect(found.map((match) => [match.name, match.from, match.to])).toStrictEqual([
      ["otp", 2, 11],
      ["link", 14, 24],
    ]);
  });

  /* The two failures are opposite: an unknown name refuses the send, a run that is not a
     placeholder is delivered as typed. An editor has to draw them differently. */
  it("marks a braced run the grammar refuses with a null name", () => {
    expect(scanPlaceholders("{{#if x}}").map((match) => match.name)).toStrictEqual([null]);
    expect(scanPlaceholders("{{ 1 + 1 }}").map((match) => match.name)).toStrictEqual([null]);
    expect(scanPlaceholders("{{ user.Email }}").map((match) => match.name)).toStrictEqual([null]);
  });

  it("keeps a well-formed name whether or not it is in scope", () => {
    expect(scanPlaceholders("{{ nonsense }}")[0]?.name).toBe("nonsense");
  });

  it("agrees with the validator about which runs are placeholders", () => {
    const source = "{{ otp }} {{#if}} {{ link }}";
    const scanned = scanPlaceholders(source);
    expect(scanned.filter((match) => match.name !== null).map((match) => match.name)).toStrictEqual(
      referencedVariables(source),
    );
    expect(scanned.filter((match) => match.name === null).map((match) => match.text)).toStrictEqual(
      unmatchedPlaceholders(source),
    );
  });

  it("hands back the offsets of the run itself, braces included", () => {
    const source = "code: {{ otp }}";
    const match = scanPlaceholders(source)[0];
    expect(source.slice(match?.from, match?.to)).toBe("{{ otp }}");
  });

  it("is not left holding a regex position between calls", () => {
    const source = "{{ otp }} and {{ link }}";
    expect(scanPlaceholders(source)).toStrictEqual(scanPlaceholders(source));
  });
});

describe("VARIABLE_HELP", () => {
  it("says what every variable holds, so no completion row is blank", () => {
    const named = new Set<TemplateVariable>([
      ...ALWAYS_IN_SCOPE,
      ...TEMPLATE_CATALOGUE.flatMap((entry) => entry.variables),
    ]);
    for (const name of named) {
      expect(VARIABLE_HELP[name].summary.length).toBeGreaterThan(0);
      expect(VARIABLE_HELP[name].detail.length).toBeGreaterThan(0);
    }
  });
});

describe("statusOf", () => {
  it("says Unavailable for a message no flow sends, whatever is stored", () => {
    expect(statusOf({ live: false, source: "yours", compiling: 0 })).toBe("unavailable");
    expect(statusOf({ live: false, source: "built_in", compiling: 3 })).toBe("unavailable");
  });

  /* The window this whole distinction exists for: published, and not yet what sends. */
  it("says Compiling while a saved row has not been through the worker pool", () => {
    expect(statusOf({ live: true, source: "built_in", compiling: 1 })).toBe("compiling");
    expect(statusOf({ live: true, source: "yours", compiling: 1 })).toBe("compiling");
  });

  it("distinguishes the project's copy from ours once everything has compiled", () => {
    expect(statusOf({ live: true, source: "yours", compiling: 0 })).toBe("active");
    expect(statusOf({ live: true, source: "built_in", compiling: 0 })).toBe("built_in");
  });

  it("has a label for every state", () => {
    for (const status of ["active", "compiling", "built_in", "unavailable"] as const) {
      expect(TEMPLATE_STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
  });
});

describe("localeStatusOf", () => {
  /* Unsaved work outranks everything, because it is the state this screen exists to
     stop losing: a language saved and still compiling with an edit on top of it is a
     language with an edit on top of it. */
  it("puts a draft above every saved state", () => {
    expect(localeStatusOf({ dirty: true, stored: true, compiled: true })).toBe("draft");
    expect(localeStatusOf({ dirty: true, stored: false, compiled: false })).toBe("draft");
  });

  it("separates sending from compiling for a saved language", () => {
    expect(localeStatusOf({ dirty: false, stored: true, compiled: true })).toBe("active");
    expect(localeStatusOf({ dirty: false, stored: true, compiled: false })).toBe("compiling");
  });

  it("says a language with nothing stored is on the built-in", () => {
    expect(localeStatusOf({ dirty: false, stored: false, compiled: false })).toBe("none");
  });

  it("has a label for every state", () => {
    for (const status of ["draft", "compiling", "active", "none"] as const) {
      expect(LOCALE_STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
  });
});

describe("bodiesEqual", () => {
  const bodies: TemplateBodies = { subject: "s", html: "<p>h</p>", text: "t" };

  it("compares all three, because they are one message", () => {
    expect(bodiesEqual(bodies, { ...bodies })).toBe(true);
    for (const field of ["subject", "html", "text"] as const) {
      expect(bodiesEqual(bodies, { ...bodies, [field]: "changed" })).toBe(false);
    }
  });
});

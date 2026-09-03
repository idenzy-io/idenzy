import { TemplateType } from "@idenzy/protocol/enums/delivery";
import { describe, expect, it } from "vitest";
import { referencedVariables } from "../src/binding.js";
import { englishTemplates } from "../src/defaults/en.js";
import { NoStoredTemplates, TemplateRenderer, TemplateStore } from "../src/renderer.js";
import type { EmailTemplate } from "../src/template.js";

const PROJECT = "prj-1";

const variables = {
  project: { name: "Acme" },
  user: { email: "user@acme.test" },
  otp: "123456",
  link: "https://acme.test/auth/callback?code=abc",
  new_email: "new@acme.test",
  expires_in: "10 minutes",
};

class FixedStore extends TemplateStore {
  constructor(private readonly stored: readonly EmailTemplate[]) {
    super();
  }
  override find(
    _projectId: string,
    type: TemplateType,
    locale: string,
  ): Promise<EmailTemplate | null> {
    return Promise.resolve(this.stored.find((t) => t.type === type && t.locale === locale) ?? null);
  }
}

describe("rendering", () => {
  const renderer = new TemplateRenderer(new NoStoredTemplates());

  it("renders the built-in code mail with the code in both bodies", async () => {
    const mail = await renderer.render(PROJECT, TemplateType.EmailOtp, "en", variables);
    expect(mail.subject).toBe("123456 is your Acme sign-in code");
    expect(mail.html).toContain("123456");
    expect(mail.text).toContain("123456");
    expect(mail.locale).toBe("en");
  });

  it("falls back to English for a locale nobody has translated", async () => {
    const mail = await renderer.render(PROJECT, TemplateType.MagicLink, "tr-TR", variables);
    expect(mail.locale).toBe("en");
    expect(mail.html).toContain("https://acme.test/auth/callback?code=abc");
  });

  /**
   * The customer's copy carries their product's name and voice; ours carries neither.
   * A project that translated `en` and not `tr` must not have our Turkish preferred
   * over their English.
   */
  it("prefers the customer's whole chain over any built-in", async () => {
    const store = new FixedStore([
      {
        type: TemplateType.EmailOtp,
        locale: "en",
        subject: "Acme code",
        html: "<p>{{ otp }}</p>",
        text: "{{ otp }}",
      },
    ]);
    const mail = await new TemplateRenderer(store).render(
      PROJECT,
      TemplateType.EmailOtp,
      "tr-TR",
      variables,
    );
    expect(mail.subject).toBe("Acme code");
  });

  it("uses the closest locale the customer does have", async () => {
    const base = { type: TemplateType.EmailOtp, html: "<p>{{ otp }}</p>", text: "{{ otp }}" };
    const store = new FixedStore([
      { ...base, locale: "en", subject: "english" },
      { ...base, locale: "tr", subject: "turkce" },
    ]);
    const mail = await new TemplateRenderer(store).render(
      PROJECT,
      TemplateType.EmailOtp,
      "tr-TR",
      variables,
    );
    expect(mail.subject).toBe("turkce");
  });
});

describe("the built-in set", () => {
  it("covers every template type phase 1 sends", () => {
    for (const type of [
      TemplateType.EmailOtp,
      TemplateType.MagicLink,
      TemplateType.EmailVerification,
      TemplateType.PasswordReset,
      TemplateType.EmailChangeOld,
      TemplateType.EmailChangeNew,
    ]) {
      expect(englishTemplates.has(type), type).toBe(true);
    }
  });

  /** Every placeholder we ship must be one the flows actually pass, or the send throws. */
  it("references only variables the flows supply", () => {
    const supplied = new Set([
      "project.name",
      "user.email",
      "otp",
      "link",
      "new_email",
      "expires_in",
    ]);
    for (const template of englishTemplates.values()) {
      const referenced = [
        ...referencedVariables(template.subject),
        ...referencedVariables(template.html),
        ...referencedVariables(template.text),
      ];
      for (const name of referenced) {
        expect(supplied.has(name), `${template.type} references ${name}`).toBe(true);
      }
    }
  });

  /** No images, no fonts, no trackers: a transactional mail should fetch nothing. */
  it("loads nothing from the network except the link the user clicks", () => {
    for (const template of englishTemplates.values()) {
      expect(template.html).not.toMatch(/<img|<script|url\(|@import/i);
      expect(template.html.match(/https?:\/\//g)).toBeNull();
    }
  });
});

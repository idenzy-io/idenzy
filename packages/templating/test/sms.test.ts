import { TemplateType } from "@idenzy/protocol/enums/delivery";
import { describe, expect, it } from "vitest";
import { englishSmsTemplates } from "../src/defaults/sms-en.js";
import { measure } from "../src/segments.js";
import { NoStoredSmsTemplates, SmsRenderer, SmsTemplateStore } from "../src/sms-renderer.js";
import type { SmsTemplate } from "../src/template.js";

const variables = {
  otp: "483920",
  project: { name: "Acme" },
  expires_in: "10 minutes",
};

function renderer(store: SmsTemplateStore = new NoStoredSmsTemplates()) {
  return new SmsRenderer(store);
}

class StoredIn extends SmsTemplateStore {
  constructor(private readonly templates: readonly SmsTemplate[]) {
    super();
  }
  override find(_projectId: string, type: TemplateType, locale: string) {
    return Promise.resolve(
      this.templates.find((t) => t.type === type && t.locale === locale) ?? null,
    );
  }
}

describe("measuring a body", () => {
  it("counts a plain message as one GSM-7 segment", () => {
    expect(measure("483920 is your code")).toEqual({
      encoding: "gsm-7",
      units: 19,
      segments: 1,
    });
  });

  /**
   * The cliff the whole module exists for. One character past 160 costs a second
   * segment, and the second segment holds 153 rather than 160 because the concatenation
   * header takes the rest.
   */
  it("charges a second segment for the 161st character", () => {
    expect(measure("a".repeat(160)).segments).toBe(1);
    expect(measure("a".repeat(161)).segments).toBe(2);
    expect(measure("a".repeat(306)).segments).toBe(2);
    expect(measure("a".repeat(307)).segments).toBe(3);
  });

  it("counts a GSM-7 escape character twice", () => {
    expect(measure("[").units).toBe(2);
    expect(measure("€").units).toBe(2);
    expect(measure(`${"a".repeat(159)}[`).segments).toBe(2);
  });

  /**
   * One character outside the alphabet drops the whole message, not just that character.
   * A curly apostrophe in a template is a costing decision.
   */
  it("drops the whole message to UCS-2 for one character outside GSM-7", () => {
    const smart = measure("It’s your code");
    expect(smart.encoding).toBe("ucs-2");
    expect(measure("a".repeat(70)).segments).toBe(1);
    expect(measure(`’${"a".repeat(69)}`).segments).toBe(1);
    expect(measure(`’${"a".repeat(70)}`).segments).toBe(2);
  });

  it("counts an emoji the way a carrier does, as two units", () => {
    const withEmoji = measure("\u{1F389}");
    expect(withEmoji.encoding).toBe("ucs-2");
    expect(withEmoji.units).toBe(2);
  });

  it("has no segments for an empty body", () => {
    expect(measure("").segments).toBe(0);
  });
});

describe("rendering an sms", () => {
  it("substitutes the variables and prices the result", async () => {
    const rendered = await renderer().render("prj", TemplateType.SmsOtp, "en", variables);

    expect(rendered.body).toBe(
      "483920 is your Acme code. It expires in 10 minutes. Do not share it.",
    );
    expect(rendered.locale).toBe("en");
    expect(rendered.length.segments).toBe(1);
  });

  /**
   * The failure this guards is silent: a translation gains a word, every OTP costs twice
   * as much, and nothing anywhere reports an error.
   */
  it("keeps every built-in inside one GSM-7 segment", async () => {
    for (const [type] of englishSmsTemplates) {
      const rendered = await renderer().render("prj", type, "en", {
        ...variables,
        project: { name: "A reasonably long product name" },
      });
      expect(rendered.length.encoding, type).toBe("gsm-7");
      expect(rendered.length.segments, type).toBe(1);
    }
  });

  it("prefers the customer's own copy over ours, down the whole chain", async () => {
    const store = new StoredIn([
      { type: TemplateType.SmsOtp, locale: "en", body: "Acme: {{ otp }}" },
    ]);
    const rendered = await renderer(store).render("prj", TemplateType.SmsOtp, "tr-TR", variables);
    expect(rendered.body).toBe("Acme: 483920");
    expect(rendered.locale).toBe("en");
  });

  it("wraps the body in the SMS Retriever format when a hash is registered", async () => {
    const rendered = await renderer().render("prj", TemplateType.SmsOtp, "en", variables, {
      retrieverHash: "FA+9qCX9VSu",
    });
    expect(rendered.body.startsWith("<#> ")).toBe(true);
    expect(rendered.body.endsWith("\nFA+9qCX9VSu")).toBe(true);
  });

  /**
   * The hash and the marker are paid for like any other characters, so the price has to
   * be taken after they are added or a project with autofill is under-metered.
   */
  it("prices the retriever hash as part of the message", async () => {
    const plain = await renderer().render("prj", TemplateType.SmsOtp, "en", variables);
    const withHash = await renderer().render("prj", TemplateType.SmsOtp, "en", variables, {
      retrieverHash: "FA+9qCX9VSu",
    });
    expect(withHash.length.units).toBeGreaterThan(plain.length.units);
  });

  it("refuses a template type it has no copy for", async () => {
    await expect(
      renderer().render("prj", TemplateType.MagicLink, "en", variables),
    ).rejects.toThrowError(/internal/i);
  });
});

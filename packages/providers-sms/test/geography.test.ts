import { E164PhoneNumber } from "@idenzy/core/value-objects/e164-phone-number";
import { describe, expect, it } from "vitest";
import { MetadataPhoneGeography } from "../src/metadata-phone-geography.js";

const geography = new MetadataPhoneGeography();

function place(number: string) {
  return geography.place(E164PhoneNumber.parse(number));
}

describe("placing a destination", () => {
  it("names the country a number belongs to", () => {
    expect(place("+14155550123").country).toBe("US");
    expect(place("+442071838750").country).toBe("GB");
    expect(place("+905321234567").country).toBe("TR");
  });

  /**
   * The reason the full metadata set is a dependency rather than a table of calling
   * codes. Twenty countries share +1, and a project allowing the United States must not
   * thereby be allowing every Caribbean range on the same prefix, which is where the
   * expensive traffic is.
   */
  it("separates countries that share a calling code", () => {
    expect(place("+18762345678").country).toBe("JM");
    expect(place("+16045550123").country).toBe("CA");
    expect(place("+14155550123").country).toBe("US");
  });

  it("flags a premium-rate range", () => {
    expect(place("+448700000000").premiumRate).toBe(true);
    expect(place("+447700900123").premiumRate).toBe(false);
  });

  /**
   * Valid E.164, unassigned range. The guard reads a null country as not allowed, so
   * this has to come back placeable-as-nothing rather than throwing.
   */
  it("answers null for a number it cannot place", () => {
    expect(place("+9999999999").country).toBeNull();
  });
});

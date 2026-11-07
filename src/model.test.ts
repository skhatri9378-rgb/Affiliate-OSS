import { describe, it, expect } from "vitest";
import { blankLink, linkSchema } from "./model";
describe("simple link validation", () => {
  it("requires a name, country, website and HTTP(S) URL", () => {
    expect(linkSchema.safeParse(blankLink()).success).toBe(false);
    expect(
      linkSchema.safeParse({
        ...blankLink(),
        name: "A",
        countryId: "c",
        siteId: "s",
        websiteId: "w",
        url: "javascript:alert(1)",
      }).success,
    ).toBe(false);
  });
  it("preserves referral parameters exactly", () => {
    const url = "https://example.invalid/?ref=A%2Fb&sub=hello+world&sub=2#keep";
    const result = linkSchema.parse({
      ...blankLink(),
      name: "Japan link",
      countryId: "c",
      siteId: "s",
      websiteId: "w",
      url,
    });
    expect(result.url).toBe(url);
  });
  it("does not trim or rewrite surrounding URL whitespace", () => {
    expect(
      linkSchema.safeParse({
        ...blankLink(),
        name: "A",
        countryId: "c",
        siteId: "s",
        websiteId: "w",
        url: " https://example.invalid",
      }).success,
    ).toBe(false);
  });
});

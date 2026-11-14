import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { htmlToText } from "../src/lib/htmlToText";

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), "tests/fixtures/htmlToText.json"), "utf8"),
) as { cases: Array<{ name: string; html: string; text: string }> };

describe("shared htmlToText (R1)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(htmlToText(c.html)).toBe(c.text);
    });
  }

  it("matches the old stripHtml output for plain markup", () => {
    // readiumEngine used to strip script/style then all tags then collapse
    const legacy = (html: string) =>
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const sample = "<p>Hello <b>world</b></p><p>Second line.</p>";
    expect(htmlToText(sample)).toBe(legacy(sample));
  });

  it("decodes entities the old extraction kept literal", () => {
    expect(htmlToText("<p>Tom &amp; Jerry&#8217;s</p>")).toBe("Tom & Jerry’s");
  });
});

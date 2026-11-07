import { describe, it, expect } from "vitest";
import MiniSearch, { escapeHtml } from "../src/search/miniSearch";

describe("miniSearch snippets", () => {
  it("escapes imported book text before adding highlight markup", () => {
    const idx = new MiniSearch();
    idx.add({
      id: "ch1",
      title: "A Book",
      docTitle: "A Book",
      text: "Before <script>alert(1)</script> after",
      href: "chapter-1.xhtml#opening",
      chapterTitle: "Opening",
    });

    const [hit] = idx.search("script");
    expect(hit.snippet).toContain("<mark>script</mark>");
    expect(hit.snippet).not.toContain("<script>");
    expect(hit.snippet).toContain("&lt;");
    expect(hit.snippet).toContain("&gt;");
    expect(hit.href).toBe("chapter-1.xhtml#opening");
    expect(hit.docTitle).toBe("A Book");
    expect(hit.chapterTitle).toBe("Opening");
  });

  it("escapes text when the query only matches the document title", () => {
    const idx = new MiniSearch();
    idx.add({
      id: "ch1",
      title: "Danger",
      text: '<img src=x onerror="alert(1)">',
    });

    const [hit] = idx.search("danger");
    expect(hit.snippet).not.toContain("<img");
    expect(hit.snippet).toContain("&lt;img");
    expect(hit.snippet).toContain("&quot;");
  });

  it("keeps the original casing of the matched term inside <mark>", () => {
    const idx = new MiniSearch();
    idx.add({ id: "ch1", title: "Doc", text: "The Quick Brown Fox" });

    const [hit] = idx.search("quick");
    expect(hit.snippet).toContain("<mark>Quick</mark>");
  });

  it("escapeHtml handles all five markup characters", () => {
    expect(escapeHtml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&#39;");
  });
});

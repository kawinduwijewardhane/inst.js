import { describe, expect, it } from "vitest";
import {
  documentResponse,
  escapeHtml,
  html,
  raw,
  renderDocument,
  streamHtml,
} from "./index.js";

describe("render", () => {
  it("escapes interpolated HTML by default", () => {
    const name = '<script>alert("x")</script>';
    const output = html`<h1>${name}</h1>`;

    expect(output.value).toBe(
      "<h1>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</h1>",
    );
    expect(escapeHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
  });

  it("allows explicitly trusted HTML fragments", () => {
    const output = html`<main>${raw("<strong>Inst</strong>")}</main>`;
    expect(output.value).toBe("<main><strong>Inst</strong></main>");
  });

  it("renders a complete document with metadata", () => {
    const output = renderDocument({
      body: html`<main>${"Hello"}</main>`,
      meta: {
        title: "Inst & friends",
        description: "Fast <web> apps",
        canonical: "https://example.com/?a=1&b=2",
      },
    });

    expect(output).toContain("<!doctype html>");
    expect(output).toContain("<title>Inst &amp; friends</title>");
    expect(output).toContain('content="Fast &lt;web&gt; apps"');
    expect(output).toContain('href="https://example.com/?a=1&amp;b=2"');
    expect(output).toContain("<main>Hello</main>");
  });

  it("renders escaped Open Graph and Twitter metadata", () => {
    const output = renderDocument({
      body: html`<main>Article</main>`,
      meta: {
        openGraph: {
          title: "Inst <article>",
          description: "Server & static",
          type: "article",
          url: "https://example.com/posts/inst",
          image: "https://example.com/inst.png?a=1&b=2",
          siteName: "Inst Docs",
        },
        twitter: {
          card: "summary_large_image",
          title: "Inst <article>",
          image: "https://example.com/inst.png?a=1&b=2",
          creator: "@instjs",
        },
      },
    });

    expect(output).toContain('property="og:title" content="Inst &lt;article&gt;"');
    expect(output).toContain('property="og:type" content="article"');
    expect(output).toContain('property="og:image" content="https://example.com/inst.png?a=1&amp;b=2"');
    expect(output).toContain('name="twitter:card" content="summary_large_image"');
    expect(output).toContain('name="twitter:creator" content="@instjs"');
  });

  it("renders safe document attributes and rejects malformed names", () => {
    const output = renderDocument({
      body: "Ready",
      attributes: {
        "data-theme": "docs",
        inert: true,
      },
    });

    expect(output).toContain('data-theme="docs"');
    expect(output).toContain(" inert");
    expect(() =>
      renderDocument({
        body: "Unsafe",
        attributes: { 'lang onload="alert(1)': "x" },
      }),
    ).toThrow("Invalid HTML attribute name");
  });

  it("returns HTML responses without replacing custom headers", async () => {
    const response = documentResponse(
      { body: html`<p>Ready</p>` },
      { headers: { "cache-control": "public, max-age=60" } },
    );

    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(await response.text()).toContain("<p>Ready</p>");
  });

  it("streams safe HTML chunks", async () => {
    async function* content() {
      yield html`<h1>${"Inst"}</h1>`;
      yield "<unsafe>";
      yield raw("<footer>Done</footer>");
    }

    const response = streamHtml(content());
    expect(await response.text()).toBe(
      "<h1>Inst</h1>&lt;unsafe&gt;<footer>Done</footer>",
    );
  });
});

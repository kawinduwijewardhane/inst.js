import { describe, expect, it } from "vitest";
import { Fragment, jsx, jsxs } from "./jsx-runtime.js";

describe("jsx runtime", () => {
  it("renders elements, components, fragments, and escaped children", () => {
    function Card({ title }: { readonly title: string }) {
      return jsxs("section", {
        className: "card",
        children: [jsx("h2", { children: title }), jsx("p", { children: "<safe>" })],
      });
    }

    const output = jsxs(Fragment, {
      children: [jsx(Card, { title: "Inst & TSX" }), jsx("br", {})],
    });

    expect(output.value).toBe(
      '<section class="card"><h2>Inst &amp; TSX</h2><p>&lt;safe&gt;</p></section><br>',
    );
  });

  it("renders boolean and style attributes", () => {
    const output = jsx("input", {
      className: "field",
      disabled: true,
      style: { backgroundColor: "black", lineHeight: 1.5 },
    });

    expect(output.value).toBe(
      '<input class="field" disabled style="background-color:black;line-height:1.5">',
    );
  });

  it("rejects server-side event handlers", () => {
    expect(() => jsx("button", { onClick() {}, children: "Save" })).toThrow(
      "cannot serialize event handler onClick",
    );
  });
});

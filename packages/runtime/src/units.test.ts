import { describe, expect, it } from "vitest";
import { defineCapability, defineUnit, provide, type InstUnit } from "@instjs/core/units";
import { createApplication } from "./index.js";

describe("capability Units", () => {
  it("executes a diamond graph once per request with typed capabilities", async () => {
    let calls = 0;
    const greeting = defineCapability<string>("greeting");
    const source = defineUnit({ name: "source", requires: [greeting], execute: ({ get }) => { calls++; return get(greeting); } });
    const left = defineUnit({ name: "left", dependencies: [source], execute: ({ use }) => use(source) });
    const right = defineUnit({ name: "right", dependencies: [source], execute: ({ use }) => use(source) });
    const home = defineUnit({ name: "home", dependencies: [left, right], async execute({ use }) {
      return new Response(`${await use(left)} ${await use(right)}`);
    } });
    const app = await createApplication({ capabilities: [provide(greeting, "hello")] });
    app.unit({ method: "GET", path: "/", unit: home });
    expect(await (await app.fetch(new Request("http://localhost/"))).text()).toBe("hello hello");
    expect(calls).toBe(1);
    const head = await app.fetch(new Request("http://localhost/", { method: "HEAD" }));
    expect(await head.text()).toBe("");
    expect(calls).toBe(2);
    expect(app.units()[0]?.nodes.map((node) => node.name)).toEqual(["source", "left", "right", "home"]);
  });

  it("rejects missing bindings and cyclic or ambiguous graphs before registration", async () => {
    const app = await createApplication();
    const capability = defineCapability<string>("secret");
    const unit = defineUnit({ name: "home", requires: [capability], execute: () => new Response() });
    expect(() => app.unit({ path: "/", unit })).toThrow("Missing capability");
    const dependencies: InstUnit<unknown>[] = [];
    const cyclic: InstUnit<Response> = { name: "cycle", dependencies, execute: () => new Response() };
    dependencies.push(cyclic);
    expect(() => app.unit({ path: "/", unit: cyclic })).toThrow("Cyclic");
    const duplicate = defineUnit({ name: "home", dependencies: [defineUnit({ name: "home", execute: () => 1 })], execute: () => new Response() });
    expect(() => app.unit({ path: "/", unit: duplicate })).toThrow("Duplicate Unit name");
    expect(app.routes()).toEqual([]);
  });

  it("enforces declarations and uses the production error boundary", async () => {
    const secret = defineCapability<string>("secret");
    const app = await createApplication({ mode: "production", capabilities: [provide(secret, "private")] });
    app.unit({ path: "/", unit: defineUnit({ name: "home", execute: ({ get }) => new Response(get(secret)) }) });
    const response = await app.fetch(new Request("http://localhost/"));
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Internal Server Error");
  });

  it("stops before executing an aborted request", async () => {
    let calls = 0;
    const app = await createApplication({ mode: "production" });
    app.unit({ path: "/", unit: defineUnit({ name: "home", execute() { calls++; return new Response(); } }) });
    await app.fetch(new Request("http://localhost/", { signal: AbortSignal.abort() }));
    expect(calls).toBe(0);
  });
});

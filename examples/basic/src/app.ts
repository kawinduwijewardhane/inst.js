import { createApplication } from "@instjs/runtime";
import { documentResponse, html } from "@instjs/render";
import { defineCapability, defineUnit, provide } from "@instjs/core/units";

const siteTitle = defineCapability<string>("site.title");

const app = await createApplication({
  mode: process.env.NODE_ENV === "production" ? "production" : "development",
  capabilities: [provide(siteTitle, "Inst.js starter")],
});

const home = defineUnit({
  name: "home",
  requires: [siteTitle],
  execute({ get }) {
    return documentResponse({
      meta: {
        title: get(siteTitle),
        description: "A minimal server-rendered Inst.js application.",
      },
      body: html`
        <main>
          <h1>Inst.js</h1>
          <p>Your application is running.</p>
        </main>
      `,
    });
  },
});
app.unit({ method: "GET", path: "/", unit: home });

app.route({
  path: "/api/health",
  handle() {
    return Response.json({ status: "ok" });
  },
});

export default app;

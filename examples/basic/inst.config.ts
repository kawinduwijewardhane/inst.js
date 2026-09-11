import { defineConfig } from "@instjs/core";

export default defineConfig({
  build: {
    prerender: ["/"],
  },
});

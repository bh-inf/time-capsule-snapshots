import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@time-capsule/schema": fileURLToPath(new URL("./packages/schema/src/index.ts", import.meta.url)),
      "@time-capsule/snapshot": fileURLToPath(new URL("./packages/snapshot/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 20_000,
  },
});

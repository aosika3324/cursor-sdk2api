import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Shared defaults. Node remains the default environment; web tests are
    // routed to jsdom via the dedicated project below.
    environment: "node",
    testTimeout: 15_000,
    hookTimeout: 15_000,
    restoreMocks: true,
    projects: [
      {
        extends: true,
        test: {
          name: "backend",
          environment: "node",
          include: ["tests/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "web",
          environment: "jsdom",
          include: ["web/**/*.test.{ts,tsx}"],
          setupFiles: ["web/src/test-setup.ts"],
        },
      },
    ],
  },
});

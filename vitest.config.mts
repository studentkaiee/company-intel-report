import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      ANTHROPIC_API_KEY: "test",
      STRIPE_SECRET_KEY: "sk_test_dummy",
      TURNSTILE_SECRET_KEY: "test-secret",
      REPORT_PRICE_SGD_CENTS: "4900",
      REPORT_SIGNING_SECRET: "test-signing-secret-that-is-long-enough-123",
      REPORT_HMAC_SECRET: "test-hmac-secret-for-person-screen-long-enough",
      PERSON_SCREEN_PRICE_SGD_CENTS: "2900",
    },
  },
});

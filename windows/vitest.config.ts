import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: ".cache/vite",
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
});

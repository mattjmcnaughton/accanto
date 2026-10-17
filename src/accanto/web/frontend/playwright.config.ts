import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  use: {
    baseURL: "http://127.0.0.1:8770",
    viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE, args: ["--no-sandbox"] },
  },
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 8770",
    url: "http://127.0.0.1:8770",
    reuseExistingServer: true,
  },
});

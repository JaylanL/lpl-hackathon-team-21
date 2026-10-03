// Browser tests for the web app: `npm test` (first time: `npx playwright install chromium`).
// The backend is faked inside each test with page.route, so no AWS account is needed.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:4173",
    // Optional: point at an already-installed Chromium instead of downloading one.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: "npm run build && npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

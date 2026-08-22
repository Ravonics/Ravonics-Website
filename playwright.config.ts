import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // The route contract runs axe against full legacy pages; allow the browser
  // enough time for that DOM walk on shared or throttled CI runners.
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:8789',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome']
  },
  webServer: {
    command: 'npm run build && python3 -m http.server 8789 --directory build/site',
    url: 'http://127.0.0.1:8789',
    // Always start the server from the artifact built by this test run. A
    // reused process can serve stale bytes and make a green test misleading.
    reuseExistingServer: false,
    timeout: 120_000
  }
});

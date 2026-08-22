import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
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
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});

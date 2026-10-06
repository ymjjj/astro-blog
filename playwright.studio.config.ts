import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/studio',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results/studio',
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  reporter: [['list'], ['json', { outputFile: 'docs/validation/studio-browser.json' }]],
  use: { baseURL: 'http://127.0.0.1:4336', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'node tests/studio/serve.mjs',
    url: 'http://127.0.0.1:4336',
    timeout: 60000,
    reuseExistingServer: false,
  },
});

import { defineConfig, devices } from '@playwright/test';
const base = (process.env.BLOG_BASE || '/').replace(/\/$/, '') + '/';
export default defineConfig({
  testDir: './tests/dev',
  outputDir: 'test-results/dev',
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'docs/validation/phase2-dev-browser.json' }]],
  use: { baseURL: `http://127.0.0.1:4324${base}`, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'npm run dev -- --port 4324',
    url: `http://127.0.0.1:4324${base}`,
    reuseExistingServer: false,
    timeout: 60000,
  },
});

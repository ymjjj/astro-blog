import { defineConfig, devices } from '@playwright/test';
const base = (process.env.BLOG_BASE || '/').replace(/\/$/, '') + '/';
export default defineConfig({
  testDir: './tests',
  outputDir: 'test-results/site',
  testIgnore: ['**/dev/**', '**/studio/**', '**/tools/**'],
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'docs/validation/browser-results.json' }]],
  use: { baseURL: `http://127.0.0.1:4321${base}`, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'npm run preview -- --port 4321',
    url: `http://127.0.0.1:4321${base}`,
    reuseExistingServer: false,
    timeout: 60000,
  },
});

import { defineConfig, devices } from '@playwright/test';

// WebKit es lo más parecido a Safari del iPad; Chromium queda como respaldo (y en CI se ejecutan ambos).
const GL = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
export default defineConfig({
  testDir: 'e2e',
  timeout: 240_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { acceptDownloads: true, trace: 'retain-on-failure' },
  projects: [
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 860 } } },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 }, launchOptions: { args: GL } },
    },
  ],
});

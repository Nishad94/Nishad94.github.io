import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  workers: 3,
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' }, grepInvert: /Firefox music report/ },
    { name: 'firefox', use: { browserName: 'firefox' }, grep: /Firefox music report/ }
  ],
  globalTeardown: './tests/cleanup-test-site.mjs',
  use: { baseURL: 'http://127.0.0.1:18765', headless: true },
  webServer: {
    command: `node tests/build-test-site.mjs && "${process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')}" tests/serve.py 18765 .test-site`,
    url: 'http://127.0.0.1:18765',
    reuseExistingServer: false
  }
});

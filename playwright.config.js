import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 3,
  use: { baseURL: 'http://127.0.0.1:18765', headless: true },
  webServer: {
    command: 'python3 tests/serve.py 18765',
    url: 'http://127.0.0.1:18765',
    reuseExistingServer: false
  }
});

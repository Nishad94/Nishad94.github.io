import { rm } from 'node:fs/promises';

export default async function cleanup() {
  await rm('.test-site', { recursive: true, force: true });
}

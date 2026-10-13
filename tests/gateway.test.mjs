import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('Mac gateway completion, error, mode and contention contracts', () => {
  const result = spawnSync('python3', ['tests/gateway_test.py'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
});

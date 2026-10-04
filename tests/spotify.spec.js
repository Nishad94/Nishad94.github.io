import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

const artist = { id: 'syntheticArtist', name: 'Synthetic Artist', genres: [] };
const track = { id: 'syntheticTrack', name: '<img src=x onerror=alert(1)> Synthetic Song', artists: [artist], explicit: true };
const profile = {
  writeUp: 'Synthetic fictional music profile. Music Personality Type: Test dreamer.',
  genres: ['Imaginary pop'],
  mbti: { type: 'TEST', summary: 'Synthetic music type', axes: [...'TEST'].map(letter => ({ letter, label: 'Dreamy', opposite: 'Busy', score: 75 })) },
  tarot: { name: 'The Test Fixture', emoji: '*', tagline: 'The fixtures align', flavorText: 'Entirely fictional.' },
  compatibility: { score: 42, label: 'Synthetic selector', roasts: { gentle: 'Gentle fixture', cheeky: 'Cheeky fixture', spicy: 'Spicy fixture' } }
};

async function command(page, value) {
  await page.locator('#term-input').fill(value);
  await page.locator('#term-input').press('Enter');
}

async function seed(page, options = {}) {
  await page.goto('/');
  await page.evaluate(options => {
    sessionStorage.setItem('nishad_spotify_auth', JSON.stringify({
      accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh',
      expiresAt: Date.now() + (options.expired ? -1000 : 3600000),
      scope: options.topOnly ? 'user-top-read' : 'user-top-read user-read-recently-played'
    }));
    localStorage.setItem('nishad_ai_proxy', 'off');
    if (options.key) localStorage.setItem('nishad_hosted_key', 'sk-synthetic-test-only');
    if (options.cap) localStorage.setItem('nishad_hosted_spend', '0.5');
  }, options);
  await page.reload();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { if (!localStorage.getItem('nishad_ai_proxy')) localStorage.setItem('nishad_ai_proxy', 'off'); });
  await page.route('https://**/*', route => route.abort());
});

test('button-only UI connects, selects reports, manages key, and disconnects', async ({ page }) => {
  await page.goto('/#music');
  await page.getByRole('button', { name: 'Connect Spotify', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Agree & continue to Spotify' })).toBeVisible();
  await seed(page);
  await mockSpotify(page);
  await page.getByRole('button', { name: 'Last 4 weeks', exact: true }).click();
  await expect(page.locator('.vibe-consent')).toBeVisible();
  await page.getByText('Add or remove your OpenAI key', { exact: true }).click();
  await page.getByLabel('OpenAI API key', { exact: true }).fill('sk-synthetic-test-only');
  await page.getByRole('button', { name: 'Save my key', exact: true }).click();
  await expect(page.locator('#music-ai-status')).toContainText('OpenAI key ready');
  await expect(page.getByLabel('OpenAI API key', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Remove AI key', exact: true }).click();
  await expect(page.locator('#music-ai-status')).toContainText('No OpenAI key');
  await page.getByRole('button', { name: 'Past vs now', exact: true }).click();
  await expect(page.locator('#spotify-output')).toContainText('In both samples');
  await page.getByRole('button', { name: 'Disconnect Spotify', exact: true }).click();
  await expect(page.locator('.spotify-data')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('nishad_spotify_auth'))).toBeNull();
});

async function mockSpotify(page) {
  await page.route('https://api.spotify.com/v1/**', route => {
    const url = route.request().url();
    return route.fulfill({ json: { items: url.includes('recently-played')
      ? [{ track, played_at: '2026-10-01T10:00:00Z' }]
      : url.includes('/artists') ? [artist] : [track, null] } });
  });
}

test('PKCE login, callback scrubbing, reload, safe results, no-key, disconnect', async ({ page }) => {
  let tokenBody, authURL, pending, apiCalls = 0;
  await mockSpotify(page);
  page.on('request', r => { if (r.url().startsWith('https://api.spotify.com/')) apiCalls++; });
  await page.route('https://accounts.spotify.com/authorize?**', async route => {
    authURL = new URL(route.request().url());
    await route.fulfill({ contentType: 'text/html', body: '<p>Synthetic authorization page</p>' });
  });
  await page.route('https://accounts.spotify.com/api/token', route => {
    tokenBody = new URLSearchParams(route.request().postData());
    return route.fulfill({ json: { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600, token_type: 'Bearer', scope: 'user-top-read' } });
  });
  await page.goto('/');
  await command(page, 'vibe medium');
  expect(apiCalls).toBe(0);
  const navigation = page.waitForURL('https://accounts.spotify.com/authorize?**');
  await page.getByRole('button', { name: 'Agree & continue to Spotify' }).click();
  await navigation;
  await page.goto('/');
  pending = await page.evaluate(() => JSON.parse(sessionStorage.getItem('nishad_spotify_pending')));
  expect(authURL.searchParams.get('code_challenge_method')).toBe('S256');
  expect(authURL.searchParams.get('scope')).toBe('user-top-read');
  expect(authURL.searchParams.get('code_challenge')).toBe(createHash('sha256').update(pending.verifier).digest('base64url'));
  expect(authURL.searchParams.get('state')).toBe(pending.state);
  expect(pending.verifier).toHaveLength(86);
  await page.goto('/spotify-callback.html?code=synthetic-code&state=' + pending.state);
  await expect(page).toHaveURL(/\/#music$/);
  await expect(page.locator('.vibe-consent')).toBeVisible();
  expect(tokenBody.get('client_secret')).toBeNull();
  expect(tokenBody.get('code_verifier')).toBe(pending.verifier);
  expect(tokenBody.get('redirect_uri')).toBe('http://127.0.0.1:18765/spotify-callback.html');
  await expect(page.locator('#spotify-output')).toContainText(track.name);
  expect(await page.locator('.spotify-data img').count()).toBe(1);
  expect(await page.evaluate(() => sessionStorage.getItem('nishad_spotify_pending'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('nishad_spotify_auth'))).toBeNull();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Generate AI report', exact: true }).click();
  await expect(page.locator('#spotify-output')).toContainText('No local model was loaded');
  await page.reload();
  await command(page, 'vibe long');
  await expect(page.locator('.vibe-consent')).toBeVisible();
  await command(page, 'spotify disconnect');
  await expect(page.locator('.spotify-data')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('nishad_spotify_auth'))).toBeNull();
});

for (const failure of ['missing', 'mismatch', 'expired', 'denied', 'missing-code', 'duplicate-state', 'replay']) {
  test('callback rejects ' + failure, async ({ page }) => {
    let exchanges = 0;
    await page.route('https://accounts.spotify.com/api/token', route => { exchanges++; return route.abort(); });
    await page.goto('/');
    const state = 's'.repeat(43);
    if (!['missing', 'replay'].includes(failure)) {
      await page.evaluate(({ state, expired }) => {
        sessionStorage.setItem('nishad_spotify_pending', JSON.stringify({
          verifier: 'v'.repeat(86), state, range: 'short',
          redirect: location.origin + '/spotify-callback.html',
          createdAt: Date.now() - (expired ? 660000 : 0)
        }));
      }, { state, expired: failure === 'expired' });
    }
    const query = failure === 'denied' ? 'error=access_denied' : failure === 'missing-code' ? '' : 'code=synthetic-secret-code';
    await page.goto('/spotify-callback.html?' + query + '&state=' + (failure === 'mismatch' ? 'wrong' : state) + (failure === 'duplicate-state' ? '&state=' + state : ''));
    await expect(page.locator('#status')).not.toContainText('Completing');
    await expect(page).toHaveURL(/\/spotify-callback.html$/);
    await expect(page.locator('body')).not.toContainText('synthetic-secret-code');
    if (failure === 'denied') await expect(page.locator('#status')).toContainText('consent was denied');
    expect(exchanges).toBe(0);
    expect(await page.evaluate(() => sessionStorage.getItem('nishad_spotify_pending'))).toBeNull();
  });
}

test('expired token refreshes once and keeps unrotated refresh token', async ({ page }) => {
  await seed(page, { expired: true });
  await mockSpotify(page);
  let refreshes = 0;
  await page.route('https://accounts.spotify.com/api/token', route => {
    const body = new URLSearchParams(route.request().postData());
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('synthetic-refresh');
    refreshes++;
    return route.fulfill({ json: { access_token: 'synthetic-new', token_type: 'Bearer', expires_in: 3600 } });
  });
  await command(page, 'vibe');
  await expect(page.locator('.vibe-consent')).toBeVisible();
  expect(refreshes).toBe(1);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('nishad_spotify_auth')).refreshToken)).toBe('synthetic-refresh');
});

test('rejected refresh clears auth without sending API requests', async ({ page }) => {
  await seed(page, { expired: true });
  let apiCalls = 0;
  await page.route('https://api.spotify.com/**', route => { apiCalls++; return route.abort(); });
  await page.route('https://accounts.spotify.com/api/token', route => route.fulfill({ status: 400, json: { error: 'invalid_grant' } }));
  await page.getByRole('button', { name: 'Last 4 weeks', exact: true }).click();
  await expect(page.locator('#spotify-output')).toContainText('rejected (400)');
  expect(apiCalls).toBe(0);
  expect(await page.evaluate(() => sessionStorage.getItem('nishad_spotify_auth'))).toBeNull();
});

test('disconnect during refresh cannot restore tokens or start another request', async ({ page }) => {
  await seed(page, { expired: true });
  let started;
  const requested = new Promise(resolve => { started = resolve; });
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  await page.route('https://accounts.spotify.com/api/token', async route => {
    started();
    await wait;
    await route.fulfill({ json: { access_token: 'late-access', refresh_token: 'late-refresh', token_type: 'Bearer', expires_in: 3600 } });
  });
  let apiCalls = 0;
  await page.route('https://api.spotify.com/**', route => { apiCalls++; return route.abort(); });
  await page.getByRole('button', { name: 'Last 4 weeks', exact: true }).click();
  await requested;
  await page.getByRole('button', { name: 'Disconnect Spotify', exact: true }).click();
  release();
  await expect(page.locator('#spotify-output')).toContainText('request cancelled');
  expect(await page.evaluate(() => sessionStorage.getItem('nishad_spotify_auth'))).toBeNull();
  expect(apiCalls).toBe(0);
  await expect(page.locator('.spotify-data')).toHaveCount(0);
});

test('disconnect cancels a pending AI report and leaves no music data behind', async ({ page }) => {
  await seed(page, { key: true });
  await mockSpotify(page);
  let started;
  const requested = new Promise(resolve => { started = resolve; });
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  await page.route('https://api.openai.com/**', async route => {
    started();
    await wait;
    await route.fulfill({ json: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(profile) } }] } });
  });
  await page.getByRole('button', { name: 'Last 4 weeks', exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Generate AI report', exact: true }).click();
  await requested;
  await page.getByRole('button', { name: 'Disconnect Spotify', exact: true }).click();
  release();
  await expect(page.locator('#spotify-output')).toContainText('AI report cancelled');
  await expect(page.locator('.spotify-data')).toHaveCount(0);
  await expect(page.locator('#spotify-output')).not.toContainText(track.name);
  await page.getByText('Add or remove your OpenAI key', { exact: true }).click();
  await page.getByRole('button', { name: 'Remove AI key', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('nishad_hosted_key'))).toBeNull();
});

test('blocked session storage reports failure without breaking the site', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
  });
  await page.getByRole('button', { name: 'Connect Spotify', exact: true }).click();
  await expect(page.locator('#spotify-output')).toContainText('Enable site storage');
  await command(page, 'whoami');
  await expect(page.locator('#term-output')).toContainText('poking around');
});

test('network and malformed Spotify responses report errors', async ({ page }) => {
  await seed(page);
  await page.route('https://api.spotify.com/**', route => route.abort());
  await command(page, 'vibe');
  await expect(page.locator('#spotify-output')).toContainText('could not be reached');
  await page.route('https://api.spotify.com/**', route => route.fulfill({ contentType: 'application/json', body: '{broken' }));
  await command(page, 'vibe');
  await expect(page.locator('#spotify-output')).toContainText('unreadable response');
});

test('refresh rotation persists and invalid token responses never replace credentials', async ({ page }) => {
  await seed(page, { expired: true });
  await mockSpotify(page);
  await page.route('https://accounts.spotify.com/api/token', route => route.fulfill({
    json: { access_token: 'rotated-access', refresh_token: 'rotated-refresh', token_type: 'Bearer', expires_in: 3600 }
  }));
  await command(page, 'vibe');
  await expect(page.locator('.vibe-consent')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('nishad_spotify_auth')).refreshToken)).toBe('rotated-refresh');
  await page.evaluate(() => {
    const auth = JSON.parse(sessionStorage.getItem('nishad_spotify_auth'));
    auth.expiresAt = 0;
    sessionStorage.setItem('nishad_spotify_auth', JSON.stringify(auth));
  });
  await page.route('https://accounts.spotify.com/api/token', route => route.fulfill({ json: { access_token: 'bad-response' } }));
  await command(page, 'vibe');
  await expect(page.locator('#spotify-output')).toContainText('invalid token response');
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('nishad_spotify_auth')).accessToken)).toBe('rotated-access');
});

for (const code of [401, 403, 429, 500]) {
  test('Spotify ' + code + ' is visible without retry loops', async ({ page }) => {
    await seed(page);
    let calls = 0;
    await page.route('https://api.spotify.com/**', route => {
      calls++;
      return route.fulfill({ status: code, headers: { 'Retry-After': '120' }, json: { error: { message: 'untrusted backend detail' } } });
    });
    await command(page, 'vibe');
    await expect(page.locator('#spotify-output')).toContainText(String(code));
    expect(calls).toBe(1);
    await expect(page.locator('#spotify-output')).not.toContainText('untrusted backend detail');
    if (code === 401) expect(await page.evaluate(() => sessionStorage.getItem('nishad_spotify_auth'))).toBeNull();
    if (code === 429) {
      await command(page, 'vibe');
      await expect(page.locator('#spotify-output')).toContainText('before trying again');
      expect(calls).toBe(1);
    }
  });
}

test('full synthetic profile: consent, safe output, spend HUD, tarot, snark without extra calls', async ({ page }) => {
  await seed(page, { key: true });
  await mockSpotify(page);
  let calls = 0;
  await page.route('https://api.openai.com/**', route => {
    calls++;
    const body = route.request().postDataJSON();
    expect(body.model).toBe('gpt-4o');
    expect(JSON.stringify(body.messages)).not.toMatch(/synthetic-access|synthetic-refresh|sk-synthetic|syntheticTrack/);
    return route.fulfill({ json: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(profile) } }], usage: { prompt_tokens: 1000, completion_tokens: 1000 } } });
  });
  await command(page, 'vibe');
  await expect(page.locator('.vibe-consent')).toBeVisible();
  expect(calls).toBe(0);
  await page.getByRole('button', { name: 'Generate AI report', exact: true }).click();
  expect(calls).toBe(0);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Generate AI report', exact: true }).click();
  await expect(page.locator('.vibe-report')).toContainText('Imaginary pop');
  await expect(page.locator('#hud-amount')).toHaveText('$0.0125');
  await page.getByRole('button', { name: 'Reveal tarot card' }).click();
  await expect(page.locator('.vibe-tarot')).toContainText('The Test Fixture');
  await page.getByRole('slider').fill('2');
  await expect(page.locator('.vibe-report')).toContainText('Spicy fixture');
  expect(calls).toBe(1);
  await command(page, 'spotify disconnect');
  expect(await page.evaluate(() => localStorage.getItem('nishad_hosted_key'))).toBe('sk-synthetic-test-only');
});

test('timeline and comparison request and render their structured reports', async ({ page }) => {
  await seed(page, { key: true });
  await mockSpotify(page);
  await page.route('https://api.openai.com/**', route => {
    const body = route.request().postDataJSON();
    const data = JSON.parse(body.messages[1].content);
    expect(body.messages[1].content).not.toContain('2026-10-01');
    const report = data.pastArtists ? { narration: 'Synthetic overlapping sample story.' } : { moods: ['Chill'] };
    return route.fulfill({ json: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(report) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } } });
  });
  await command(page, 'vibe timeline');
  await expect(page.locator('.vibe-consent')).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Generate AI report', exact: true }).click();
  await expect(page.locator('.vibe-report')).toContainText('Chill (AI guess)');
  await command(page, 'vibe compare');
  await expect(page.locator('.vibe-consent')).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Generate AI report', exact: true }).click();
  await expect(page.locator('.vibe-report')).toContainText('Synthetic overlapping sample story.');
});

test('optional recent scope is requested only by timeline reconnect', async ({ page }) => {
  await seed(page, { topOnly: true });
  await page.getByRole('button', { name: 'Mood timeline', exact: true }).click();
  await expect(page.locator('#spotify-output')).toContainText('Mood timeline needs optional recent-play access');
  await page.route('https://accounts.spotify.com/authorize?**', route => route.fulfill({ body: 'Synthetic login' }));
  await page.getByRole('button', { name: 'Agree & continue to Spotify' }).click();
  await expect(page).toHaveURL(/accounts.spotify.com/);
  expect(new URL(page.url()).searchParams.get('scope')).toBe('user-top-read user-read-recently-played');
});

test('empty and missing metadata never fabricate a report', async ({ page }) => {
  await seed(page);
  await page.route('https://api.spotify.com/**', route => route.fulfill({ json: { items: [null, {}] } }));
  await command(page, 'vibe');
  await expect(page.locator('#spotify-output')).toContainText('No usable music metadata');
  await expect(page.locator('.vibe-consent')).toHaveCount(0);
  await page.route('https://api.spotify.com/**', route => route.fulfill({ json: { items: [] } }));
  await command(page, 'vibe');
  await expect(page.locator('.spotify-data')).toContainText('Spotify returned no items');
});

for (const outcome of ['invalid', 'truncated', '401', '429', 'cap']) {
  test('AI ' + outcome + ' does not invent successful output', async ({ page }) => {
    await seed(page, { key: true, cap: outcome === 'cap' });
    await mockSpotify(page);
    let calls = 0;
    await page.route('https://api.openai.com/**', route => {
      calls++;
      if (['401', '429'].includes(outcome)) return route.fulfill({ status: Number(outcome), json: {} });
      return route.fulfill({ json: { choices: [{ finish_reason: outcome === 'truncated' ? 'length' : 'stop', message: { content: '{}' } }], usage: { prompt_tokens: 100, completion_tokens: 100 } } });
    });
    await command(page, 'vibe');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Generate AI report', exact: true }).click();
    await expect(page.locator('#spotify-output')).toContainText(outcome === 'cap' ? 'spend cap' : outcome === 'invalid' ? 'incomplete or invalid' : outcome === 'truncated' ? 'truncated' : outcome);
    await expect(page.locator('.vibe-report')).toHaveCount(0);
    expect(calls).toBe(outcome === 'cap' ? 0 : 1);
  });
}

test('existing deterministic commands, palette, local failure, BYOK streaming and lockdown survive', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  for (const [cmd, output] of [
    ['help', 'AI-powered fun modes'], ['whoami', 'guest'], ['pwd', '/home/nishad/multiverse/main'],
    ['cat about.txt', 'Carnegie Mellon'], ['git status', 'On branch main'], ['git branch', 'msft-2020'],
    ['git log', '2015  init'], ['conspiracy', 'GMAIL BRANCHING HYPOTHESIS'],
    ['echo regression', 'regression'], ['roulette', 'branch generated'], ['chaos', 'chaos mode toggled'],
    ['toffee', 'Toffee deployed'], ['history', 'whoami']
  ]) {
    await command(page, cmd);
    await expect(page.locator('#term-output')).toContainText(output);
  }
  await command(page, 'palette');
  await page.locator('#palette-input').fill('Spotify');
  await expect(page.locator('.palette-item')).toHaveCount(5);
  await page.locator('#palette-input').press('Escape');
  await page.evaluate(() => Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true }));
  await command(page, 'test local fallback');
  await expect(page.locator('#term-output')).toContainText('ai error:');
  await expect(page.locator('#term-input')).toBeEnabled();
  await command(page, 'key');
  await command(page, 'sk-synthetic-test-only');
  await expect(page.locator('#spend-hud')).toHaveClass(/on/);
  await expect(page.locator('#term-output')).not.toContainText('sk-synthetic-test-only');
  await page.route('https://api.openai.com/**', route => route.fulfill({
    contentType: 'text/event-stream',
    body: 'data: {"choices":[{"delta":{"content":"Existing hosted AI still works."}}]}\n\ndata: {"usage":{"prompt_tokens":100,"completion_tokens":100},"choices":[]}\n\ndata: [DONE]\n\n'
  }));
  await command(page, 'hype');
  await expect(page.locator('#term-output')).toContainText('Existing hosted AI still works.');
  await expect(page.locator('#hud-amount')).toHaveText('$0.0013');
  await command(page, 'lockdown');
  await expect(page.locator('#spend-hud')).not.toHaveClass(/on/);
  await command(page, 'clear');
  await expect(page.locator('#term-output')).toBeEmpty();
  expect(errors).toEqual([]);
});

for (const outcome of ['ok', 'visitor_limit', 'global_limit', 'down']) {
  test('site AI proxy ' + outcome + ' works without a visitor key and never calls OpenAI directly', async ({ page }) => {
    await seed(page, { key: false });
    await page.evaluate(() => localStorage.setItem('nishad_ai_proxy', 'http://127.0.0.1:9/report'));
    await page.reload();
    await mockSpotify(page);
    let proxyCalls = 0;
    await page.route('https://api.openai.com/**', route => { throw new Error('direct OpenAI call'); });
    await page.route('http://127.0.0.1:9/report', route => {
      proxyCalls++;
      const body = route.request().postDataJSON();
      expect(Object.keys(body)).toEqual(['messages']);
      expect(route.request().headers().authorization).toBeUndefined();
      expect(JSON.stringify(body)).not.toMatch(/synthetic-access|synthetic-refresh|syntheticTrack/);
      if (outcome === 'down') return route.abort();
      if (outcome !== 'ok') return route.fulfill({ status: 429, json: { error: outcome } });
      return route.fulfill({ json: { content: JSON.stringify(profile), finish_reason: 'stop' } });
    });
    await expect(page.locator('#music-ai-status')).toContainText('no key needed');
    await command(page, 'vibe');
    await expect(page.locator('.vibe-consent')).toContainText('site’s AI service');
    await expect(page.locator('.vibe-consent')).not.toContainText('require a key');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Generate AI report', exact: true }).click();
    if (outcome === 'ok') await expect(page.locator('.vibe-report')).toContainText('Imaginary pop');
    else {
      await expect(page.locator('#spotify-output')).toContainText(outcome === 'down' ? 'unreachable' : outcome === 'visitor_limit' ? 'today’s free AI reports' : 'budget for today');
      await expect(page.locator('.vibe-report')).toHaveCount(0);
    }
    expect(proxyCalls).toBe(1);
  });
}

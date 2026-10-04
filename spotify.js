// OAuth/API transport only; optional AI reports use a separate explicit consent flow.
export const SPOTIFY_CLIENT_ID = '34437fd629a749d9bbef6634ae012833';
export const SPOTIFY_RANGES = {
  short: { api: 'short_term', label: 'approximately the last 4 weeks' },
  medium: { api: 'medium_term', label: 'approximately the last 6 months' },
  long: { api: 'long_term', label: 'approximately the last year, including new data' }
};

const AUTH_KEY = 'nishad_spotify_auth';
const PENDING_KEY = 'nishad_spotify_pending';
const RATE_KEY = 'nishad_spotify_retry_at';
const SCOPE = 'user-top-read';
const RECENT_SCOPE = 'user-read-recently-played';
const VIEWS = ['short', 'medium', 'long', 'timeline', 'compare'];
const LOGIN_TTL = 10 * 60 * 1000;
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
let generation = 0;
let controller = new AbortController();
let refreshing = null;

export class SpotifyError extends Error {}

function storage(action, key, value) {
  try {
    return sessionStorage[action](key, value);
  } catch {
    throw new SpotifyError('Spotify needs session storage in this tab. Enable site storage, then reconnect.');
  }
}

function read(key) {
  const raw = storage('getItem', key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    storage('removeItem', key);
    throw new SpotifyError('Spotify session data was invalid and has been removed. Use spotify connect.');
  }
}

function write(key, value) {
  storage('setItem', key, JSON.stringify(value));
}

function validToken(token) {
  return typeof token === 'string' && token.length > 0 && token.length <= 8192 && !/\s/.test(token);
}

function auth() {
  const value = read(AUTH_KEY);
  if (!value) return null;
  if (!validToken(value.accessToken) || !Number.isFinite(value.expiresAt) ||
      (value.refreshToken !== null && !validToken(value.refreshToken))) {
    storage('removeItem', AUTH_KEY);
    throw new SpotifyError('Spotify session is invalid. Use spotify connect to sign in again.');
  }
  return value;
}

export function spotifyStatus() {
  const value = auth();
  if (!value) return 'Spotify is disconnected.';
  return value.expiresAt > Date.now() + 30000
    ? 'Spotify is connected in this tab. Choose a time-range button (or type vibe) to fetch your top items.'
    : 'Spotify access has expired; the next vibe will try one refresh. Reconnect if it fails.';
}

export function disconnectSpotify() {
  generation++;
  controller.abort();
  controller = new AbortController();
  refreshing = null;
  storage('removeItem', AUTH_KEY);
  storage('removeItem', PENDING_KEY);
}

function redirectURI() {
  const loopback = ['127.0.0.1', '[::1]'].includes(location.hostname);
  if (location.origin !== 'https://nishad.ai' && !(location.protocol === 'http:' && loopback)) {
    throw new SpotifyError('Spotify login is available at https://nishad.ai or an HTTP loopback IP (127.0.0.1), not localhost or preview domains.');
  }
  return location.origin + '/spotify-callback.html';
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function connectSpotify(range = 'short') {
  if (!VIEWS.includes(range)) throw new SpotifyError('Choose short, medium, long, timeline, or compare.');
  const redirect = redirectURI();
  if (!globalThis.crypto?.subtle) throw new SpotifyError('Spotify login needs a secure browser with Web Crypto.');
  disconnectSpotify();
  const current = generation;
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(64)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  if (current !== generation) throw new SpotifyError('Spotify login cancelled.');
  write(PENDING_KEY, { verifier, state, redirect, range, createdAt: Date.now() });
  const url = new URL('https://accounts.spotify.com/authorize');
  url.search = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID, response_type: 'code', redirect_uri: redirect,
    scope: range === 'timeline' ? SCOPE + ' ' + RECENT_SCOPE : SCOPE,
    state, code_challenge_method: 'S256', code_challenge: challenge,
    show_dialog: 'true'
  }).toString();
  location.assign(url.href);
}

function checkCooldown() {
  const until = read(RATE_KEY);
  if (Number.isFinite(until) && until > Date.now()) {
    throw new SpotifyError('Spotify rate/quota limit: wait ' + Math.ceil((until - Date.now()) / 1000) + ' seconds before trying again.');
  }
}

async function request(url, options = {}) {
  checkCooldown();
  const current = generation;
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
  let response;
  try {
    response = await fetch(url, {
      ...options, signal, credentials: 'omit', cache: 'no-store',
      referrerPolicy: 'no-referrer', redirect: 'error'
    });
  } catch {
    if (current !== generation) throw new SpotifyError('Spotify request cancelled; disconnected.');
    throw new SpotifyError('Spotify could not be reached (network, browser restriction, or timeout). Try again manually.');
  }
  if (current !== generation) throw new SpotifyError('Spotify request cancelled; disconnected.');
  if (response.status === 429) {
    const header = response.headers.get('Retry-After');
    const seconds = header && /^\d+$/.test(header) ? Number(header) : 60;
    write(RATE_KEY, Date.now() + Math.max(1, seconds) * 1000);
    throw new SpotifyError('Spotify rate/quota limit (429). Wait ' + Math.max(1, seconds) + ' seconds before trying again; quota restrictions may last longer.');
  }
  if (response.status === 401 || (url === TOKEN_ENDPOINT && response.status === 400)) {
    disconnectSpotify();
    throw new SpotifyError('Spotify authorization expired or was rejected (' + response.status + '). Choose Connect Spotify (or use spotify connect) to reconnect.');
  }
  if (response.status === 403) {
    throw new SpotifyError('Spotify access denied (403). Check the app owner has Premium, your account is allowlisted, and user-top-read was approved. This app or endpoint may be restricted. No automatic retry.');
  }
  if (!response.ok) {
    throw new SpotifyError('Spotify request failed (HTTP ' + response.status + '). Try again later; no automatic retry.');
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new SpotifyError('Spotify returned an unreadable response. Try again manually.');
  }
  if (current !== generation) throw new SpotifyError('Spotify request cancelled; disconnected.');
  return data;
}

async function exchange(params, previous = null, requestedScope = SCOPE) {
  const current = generation;
  const data = await request(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: SPOTIFY_CLIENT_ID, ...params })
  });
  if (!validToken(data?.access_token) || data.token_type?.toLowerCase() !== 'bearer' ||
      !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
      (data.refresh_token !== undefined && !validToken(data.refresh_token))) {
    throw new SpotifyError('Spotify returned an invalid token response. Reconnect with spotify connect.');
  }
  if (typeof data.scope === 'string' && !data.scope.split(' ').includes(SCOPE)) {
    disconnectSpotify();
    throw new SpotifyError('Spotify did not grant user-top-read. Reconnect and approve access to top items.');
  }
  if (current !== generation) throw new SpotifyError('Spotify request cancelled; disconnected.');
  const value = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? previous?.refreshToken ?? null,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope ?? previous?.scope ?? requestedScope
  };
  write(AUTH_KEY, value);
  return value;
}

export async function finishSpotifyLogin(params) {
  const pending = read(PENDING_KEY);
  // Consume the attempt even on denial/mismatch; a callback is never reusable.
  storage('removeItem', PENDING_KEY);
  const age = Date.now() - pending?.createdAt;
  if (!pending || !Number.isFinite(age) || age < 0 || age > LOGIN_TTL ||
      !/^[A-Za-z0-9_-]{86}$/.test(pending.verifier) ||
      !/^[A-Za-z0-9_-]{43}$/.test(pending.state) ||
      pending.redirect !== redirectURI() || !VIEWS.includes(pending.range) ||
      params.getAll('state').length !== 1 || params.get('state') !== pending.state) {
    throw new SpotifyError('Spotify login state is missing, mismatched, expired, or already used. Return to the original tab and start spotify connect again.');
  }
  if (params.has('error')) {
    throw new SpotifyError(params.get('error') === 'access_denied'
      ? 'Spotify consent was denied. Nothing was connected. Return to music vibes and choose Connect Spotify to try again.'
      : 'Spotify authorization failed. Return to music vibes and choose Connect Spotify again.');
  }
  if (params.getAll('code').length !== 1 || !params.get('code')) {
    throw new SpotifyError('Spotify did not return an authorization code. Start spotify connect again.');
  }
  await exchange({
    grant_type: 'authorization_code', code: params.get('code'),
    code_verifier: pending.verifier, redirect_uri: pending.redirect
  }, null, pending.range === 'timeline' ? SCOPE + ' ' + RECENT_SCOPE : SCOPE);
  return pending.range;
}

async function accessToken() {
  const value = auth();
  if (!value) throw new SpotifyError('Spotify is disconnected. Type spotify connect to review consent and sign in.');
  if (value.expiresAt > Date.now() + 30000) return value.accessToken;
  if (!value.refreshToken) {
    disconnectSpotify();
    throw new SpotifyError('Spotify session expired without a refresh token. Use spotify connect.');
  }
  if (!refreshing) {
    const promise = exchange({ grant_type: 'refresh_token', refresh_token: value.refreshToken }, value);
    refreshing = promise;
    try {
      return (await promise).accessToken;
    } finally {
      if (refreshing === promise) refreshing = null;
    }
  }
  return (await refreshing).accessToken;
}

export async function spotifyTop(type, range) {
  if (!['tracks', 'artists'].includes(type) || !Object.hasOwn(SPOTIFY_RANGES, range)) {
    throw new SpotifyError('Use vibe short, vibe medium, or vibe long.');
  }
  const current = generation;
  const token = await accessToken();
  if (current !== generation) throw new SpotifyError('Spotify request cancelled; disconnected.');
  const query = new URLSearchParams({ time_range: SPOTIFY_RANGES[range].api, limit: '50' });
  const data = await request('https://api.spotify.com/v1/me/top/' + type + '?' + query, {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (!Array.isArray(data?.items)) throw new SpotifyError('Spotify returned an invalid top-items response.');
  return data.items.slice(0, 50);
}

export function spotifyHasRecentAccess() {
  return Boolean(auth()?.scope?.split(' ').includes(RECENT_SCOPE));
}

export async function spotifyRecent() {
  if (!spotifyHasRecentAccess()) {
    throw new SpotifyError('The mood timeline needs optional recent-play access. Choose Enable recent-play access (or use spotify connect timeline) to review consent and reconnect.');
  }
  const current = generation;
  const token = await accessToken();
  if (current !== generation) throw new SpotifyError('Spotify request cancelled; disconnected.');
  const data = await request('https://api.spotify.com/v1/me/player/recently-played?limit=50', {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (!Array.isArray(data?.items)) throw new SpotifyError('Spotify returned an invalid recently-played response.');
  return data.items.slice(0, 50);
}

export function spotifyLink(item, type) {
  const url = item?.external_urls?.spotify;
  if (typeof url === 'string' && new RegExp('^https://open\\.spotify\\.com/' + type + '/[A-Za-z0-9]+$').test(url)) {
    return url;
  }
  if (typeof item?.id === 'string' && /^[A-Za-z0-9]+$/.test(item.id)) {
    return 'https://open.spotify.com/' + type + '/' + item.id;
  }
  return null;
}

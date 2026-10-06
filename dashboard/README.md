# Private metrics dashboard

A separate Go reporting service and PostgreSQL pageview collector. GitHub Pages
remains static. There is **no file browser, device connector, OpenClaw access,
session replay, AI processing or third-party analytics plugin**.

Canonical owner URL: **https://private.nishad.ai/dashboard_metrics**.
The public **https://nishad.ai/dashboard_metrics** alias only redirects there.

## Validation

Use Go 1.26+ and run:

```sh
cd dashboard
go test -race ./...
go vet ./...
go build ./cmd/dashboard
```

From the repository root run `npm run test:syntax` and `npm test`.
Backend tests use a temporary PostgreSQL instance, synthetic events and mocked
OAuth. Browser tests intercept traffic. Tests never use the real owner account,
production database or a configured OAuth secret.

## Authentication and configuration

The service accepts `--config /absolute/private/config.json`, mode 0600 or
stricter (systemd's unit-private credential mount may deliver mode 0440).
Runtime configuration must remain outside this repository, Pages output,
logs and artifacts. `deploy/` contains generic units/templates, not live secrets,
identity settings or machine addresses.

| Mode | Configuration |
| --- | --- |
| `dashboard` | `listen`, `origin`, `ownerId`, `clientId`, `clientSecret`, read-only `databaseUrl` |
| `collector` | `listen`, `databaseUrl`, `catalog`, `origins`, optional `dailyCap` (10000 default) and `geoDatabase` |
| `migrate` | `databaseUrl` for schema owner |
| `maintain` | `databaseUrl` with retention privileges |
| `purge` | `databaseUrl`, plus explicit `--confirm-purge` CLI flag |

Listeners must use numeric loopback addresses. The fixed HTTPS origin determines
the GitHub OAuth callback at `/auth/github/callback`. Pin the owner's immutable
numeric GitHub ID, not a username or first-user enrollment. No repository scope
or PAT is requested. Existing site BYOK keys are unrelated.

OAuth uses state and PKCE. The provider token is discarded after `/user`
verification. Opaque sessions are memory-only with Secure/HttpOnly/host-only
cookies, 30-minute idle and eight-hour absolute expiry. Polling does not renew
idle time. All report APIs require a session; POSTs require exact Origin and
CSRF. Restarting revokes all sessions. Missing credentials fail startup; there
is no demo authentication or production synthetic data.

## Existing-host deployment

Deployment is manual and requires explicit authorization. Do not infer a target,
change apex/www, provision billable resources or install onto existing services
without checking capacity and conflicts first.

1. Build the Linux binary as `dashboard/dashboard` and run the public site build.
   Copy only `_site/analytics-pages.json` alongside that binary as
   `dashboard/analytics-pages.json`. Do not deploy test fixtures.
2. On the approved host install nginx, PostgreSQL and certbot. Inspect current
   listeners and PostgreSQL configuration first. Keep database ingress private.
3. Run `deploy/stage.sh PRIVATE_DOMAIN COLLECTOR_DOMAIN OWNER_ID PUBLIC_CLIENT_ID`
   as root. It creates dedicated no-login service accounts, a separate database,
   least-privilege roles, mode-0600 configs, the secret setter and retention timer.
   It does not start collection or overwrite existing runtime configs.
4. From the owner's trusted interactive server terminal run:
   `sudo /usr/local/sbin/nishad-dashboard-set-oauth`.
   Paste the OAuth client secret only at its hidden prompt, never in chat,
   arguments, environment variables or Azure Run Command. It atomically saves
   root-only configuration and restarts only the report service.
5. Configure only the approved private/collector DNS records, HTTP ACME challenge
   route and TCP 80/443 ingress. Issue TLS after verifying DNS. Render the nginx
   template, verify with `nginx -t`, reload and configure cert renewal reloads.
   Preserve all unrelated sites/services and SSH rules.
6. Verify unauthenticated API denial, owner login, CSRF, collector rejection,
   private database permissions and retention. Start
   `nishad-metrics@collect.service` only when the collection endpoint is ready.
7. Set the two public URLs in `deployment.js`, publish normally and verify the
   exact public launcher and an explicitly opted-in pageview. No automatic
   deployment is performed by the dashboard CI workflow.

Systemd passes config through `LoadCredential`, not process arguments containing
secrets. Services cannot access home directories, write the OS filesystem,
elevate privilege or administer PostgreSQL. They have memory/CPU/task limits.
PostgreSQL data must reside on the persistent OS/data disk, never VM temporary
storage. Restrict host administrators and backups of the OS disk accordingly.

The report role can select only aggregate tables. The collector role can perform
bounded DML on the four metrics tables, but has no schema ownership, DDL,
superuser or unrelated database rights. UNIX-socket peer authentication avoids
database passwords. The schema is applied explicitly, not on each startup.
Database role logging suppresses statement/parameter data. App logs contain only
sanitized operation failures; never add request/content dumps.

Nginx exposes only POST/OPTIONS `/collect` on the collector hostname and the
authenticated app on the private hostname. It replaces `X-Real-IP` using the
actual peer, drops forwarding headers, disables access logs/caches/disk buffering,
limits requests and preserves no-store/security headers. Do not insert another
proxy/CDN without redesigning the trusted-peer boundary.

## Data, consent and retention

`analytics.js` runs only on catalog-approved public pages, after explicit opt-in.
It respects DNT/GPC, withdrawal and storage failures. It sends only the canonical
page path, referrer hostname and optional random daily browser ID. Queries,
fragments, HTTP referrers, terminal input, keys and private views are excluded.
No IP/User-Agent fingerprint is generated. The collector briefly uses the
network address for abuse control/optional local country lookup and the
User-Agent for best-effort bot filtering, without persisting either.

PostgreSQL stores daily totals and page/referrer/country counters. Random browser
IDs are HMAC-deduplicated under a daily random key; no raw events or IDs are
stored. Current-day keys/pseudonyms expire at the next hourly run after UTC
midnight, within a 48-hour ceiling. Aggregates retain today plus 29 prior UTC
days. Reports independently limit ranges and dimension rows. Country/referrer
buckets below five views are hidden in reports, not erased from storage.
Multi-day unique totals sum daily browsers, not distinct monthly people.

Collection performs retention on startup and hourly; failure stops collection.
The persistent hourly systemd timer also expires data when collection is stopped.
Monitor service/timer status and available disk space without dumping data.
The public endpoint can be spoofed: CORS is not event authentication. There are
per-process transient rate limits, bounded concurrency, a 2 KiB request cap and
a transactional daily storage cap. Run one collector instance.

**Initial launch intentionally has no backups, explicitly accepted by the owner.**
A VM/disk failure may lose up to all 30 retained days of aggregate metrics.
No backup resources, costs or replication are enabled. Adding backups requires
separate approval, encryption, aggregate-only scope (never keys/pseudonyms or
runtime credentials), a defined expiration and a tested restore procedure.
Local tests cover aggregate restore mechanics, not production disaster recovery.
`purge --confirm-purge` clears only metrics tables and requires elevated
maintenance privileges; neither live service has TRUNCATE permission.

## Geography and dashboard

The UI provides colored KPIs, accessible traffic charts, rankings and a local
Natural Earth map (public domain; see `web/MAP-LICENSE.txt`). No external map API,
tiles or tracking requests are used. Gray means no reportable data, not no visits.
Unmapped territories remain listed; Unknown is not assigned to a country.

Countries remain **Unknown** until an approved, licensed local country MMDB is
configured. There are no external IP lookups or automatic subscriptions.
An invalid configured file fails startup; missing/older-than-35-days data,
reserved addresses and missing results yield Unknown. Restart after an update.
No city or precise coordinates are retained.

Average/p95/p99 duration, errors and sample count describe authenticated metrics
API server processing, **not visitor page-load speed, RUM or Core Web Vitals**.
The latest 2048 operations in a rolling 15-minute window are held in memory.
Nearest-rank percentiles reset on restart; empty windows display dashes.
Session polling, auth, static assets and performance reads are excluded. Samples
contain no request body, identity, address or URL.

## Public integration and rollback

`deployment.js` contains only public HTTPS URLs and can independently disable the
launcher or collector. `/dashboard_metrics` is a constant public redirect to the
authenticated private service, not a Pages authentication mechanism. It forwards
no query/fragment. The builder never copies `dashboard/` into `_site/`.

For an immediate collection stop use
`systemctl stop nishad-metrics@collect.service`, then disable the public endpoint
and republish. Remove links and stop the report service to disable the dashboard;
links alone do not revoke access. Keep the retention timer running. Roll back
binary/config versions non-destructively; never delete persistent database
storage or alter unrelated services.

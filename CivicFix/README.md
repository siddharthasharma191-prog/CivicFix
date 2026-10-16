# CivicFix — Smart Civic Issue Reporting and Management System

**Final maintained prototype: Phases 1–5; Phase 6 audit and submission handoff** · **SDG 11: Sustainable Cities and Communities**

CivicFix is a local educational civic-technology prototype. It stores fictional demonstration reports in a local SQLite database and provides a password-protected administrative workflow for advancing report statuses. It is not connected to a real municipality, government service, public works team, or official reporting system.

## Features

- Preserves the Phase 1 responsive dashboard, navigation, report form, search, status/category filters, accessibility features, and styling.
- Initializes SQLite schema/indexes and seeds 12 fictional records only when the database is empty. Restarting does not deliberately erase or reseed existing records.
- Public `GET /api/reports` and validated `POST /api/reports` endpoints preserve Phase 2 reporting.
- Dashboard loads database reports when the API responds successfully. The API response replaces the static HTML fallback rows; an empty successful response shows zero reports and does not restore or append sample rows. If the API cannot be loaded, the original fictional rows remain visible.
- Individual fictional seed records are labeled **DEMO** using the existing `isDemo` API field. Result counts describe report rows without implying every stored record is fictional.
- Administration page with password sign-in, sign-out, a report review table, and status updates.
- Server-side authorization protects all administrative report listing and status mutation endpoints; frontend visibility is not treated as a security boundary.
- Signed, expiring `HttpOnly`, `SameSite=Strict` session cookie; `Secure` is added in production mode. State-changing admin requests require a same-origin `Origin` header.
- In-memory login throttling after repeated failed attempts; invalid status transitions are rejected.
- Helmet security headers, JSON body-size limit, safe text-only DOM rendering, generic API errors, and validated `PORT` configuration.

## Administrative setup — required

Administrative access is **disabled until both environment variables are configured**. No default administrator password or session secret is embedded in source code.

Set a private password of at least 12 characters and a session secret with at least 32 bytes of entropy in the environment that starts the server. For Windows PowerShell, for example:

```powershell
$env:CIVICFIX_ADMIN_PASSWORD = "choose-your-own-private-password"
$env:CIVICFIX_SESSION_SECRET = (node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")
$env:NODE_ENV = "development"
npm start
```

The password above is an example placeholder only; replace it with a private password. The session-secret command prints a random value. Assign that generated value to `CIVICFIX_SESSION_SECRET` in the same terminal before starting the server. Do not commit either value, put them in frontend JavaScript, or share them in screenshots. `.env.example` is a template; this application does not automatically load `.env` files.

For a deployment behind a reverse proxy, configure `CIVICFIX_PUBLIC_ORIGIN` to the exact externally visible origin (scheme and host, with no path), and terminate HTTPS at a properly configured proxy. Production cookies have the `Secure` attribute and therefore require HTTPS. The application does not configure Express proxy trust automatically.

## Authentication and security boundaries

- Admin password and session signing secret are supplied by environment variables. Configuration is considered valid only when the password is at least 12 characters and the signing secret is at least 32 bytes.
- Login issues an HMAC-signed session token that expires after four hours. The browser stores it in an `HttpOnly`, `SameSite=Strict` cookie; JavaScript cannot read the cookie directly.
- `GET /api/admin/reports` and `PATCH /api/admin/reports/:id/status` enforce server-side session authentication. Hiding or showing controls in the browser is only a user-interface choice and does not grant access.
- State-changing admin routes require a same-origin `Origin` header. The login route is rate-limited after five failed attempts from the same remote address for 15 minutes.
- Allowed transitions are forward-only: `submitted` → `under-review` → `in-progress` → `resolved`. Skipped, repeated, backwards, and unknown transitions return HTTP 409. Resolved reports have no further transition.
- Logout clears the browser cookie. Because sessions are stateless signed tokens, a copied token remains valid until expiry; rotating the session secret invalidates existing tokens.
- Login throttling is in-memory and per-process; it is not a distributed rate limiter and resets on restart. The tracker is capped at 10,000 remote-address entries. Each sign-in check performs bounded-map cleanup: expired entries are removed, while active blocks are preserved. If the tracker is full and an address has no existing entry, sign-in fails closed with HTTP 429 and a capacity message until an entry expires or is reset; active blocks are never evicted to make room. This favors protection over availability under capacity pressure. Use an appropriately configured reverse proxy and a persistent shared rate limiter before any public deployment.
- This prototype has one administrator credential and no user accounts, role management, password reset, MFA, persistent session revocation, audit log, or multi-tenant authorization. Do not treat it as production-ready for sensitive or real civic data.
- The admin password is an environment-provided secret. Restrict access to the environment and host; do not use a password that protects another account.
- SQLite is local-file persistence suitable for development/classwork, not a production multi-user data platform. The default database path is `data/civicfix.sqlite`; `CIVICFIX_DB_PATH` can override it. Relative paths resolve from the process working directory.
- Dashboard overview cards and category percentages remain illustrative sample metrics; they are not calculated from database totals.

## Requirements and setup

- Node.js 22.5.0 or later (the built-in `node:sqlite` API is experimental in this Node release line; Node 22.16.0 emits an experimental warning).
- npm.

On Windows / VS Code:

1. Extract the project and open the `CivicFix` folder containing `package.json`.
2. Install dependencies:

   ```powershell
   npm install
   ```

   Registry access previously failed with a DNS/network error (`EAI_AGAIN` resolving `registry.npmjs.org`). If that blocker persists, retry when the configured npm registry is reachable. Do not fabricate a lockfile or use unofficial package downloads.
3. Set `PORT`, `CIVICFIX_DB_PATH` if needed, and the two required admin environment variables as shown above. `.env.example` is a template only.
4. Start with `npm start`, then open `http://localhost:3000` or the configured port. The health endpoint is `/api/health`.

## API

### Public routes

- `GET /api/health` — returns service and current phase status.
- `GET /api/reports` — returns report rows with `id`, `reference`, `title`, `category`, `description`, `location`, `impact`, `priority`, `priorityReason`, `status`, `isDemo`, `createdAt`, and `updatedAt`, plus the configured priority/impact choices.
- `POST /api/reports` — validates and stores a locally stored report. Fields: `title` (5–100 chars), `category` (one of six configured categories), `location` (3–160 chars), `description` (10–1,000 chars), and optional `impact` (`minor`, `localized`, `major_access`, `immediate_safety`; omission defaults to `localized`). The server computes priority and reason. The response includes `duplicateCandidates` as non-blocking review suggestions. Returns HTTP 201 and a generated reference. Validation failures return HTTP 400; bodies over 20 KB return HTTP 413.

### Administrative routes

- `GET /api/admin/session` — reports whether admin configuration exists and whether the request has a valid session; response is marked `Cache-Control: no-store`.
- `POST /api/admin/session` — same-origin JSON request with `{ "password": "..." }`; returns HTTP 200 and sets the signed session cookie when credentials are valid. Missing configuration returns HTTP 503, wrong credentials HTTP 401, origin failure HTTP 403, and rate limiting HTTP 429.
- `DELETE /api/admin/session` — same-origin sign-out; clears the browser session cookie.
- `GET /api/admin/reports` — authenticated report review list. Returns HTTP 401 without a valid session, or HTTP 503 if admin access is not configured.
- `PATCH /api/admin/reports/:id/status` — authenticated, same-origin status update with `{ "status": "under-review" }` or the next allowed status. Invalid transitions return HTTP 409; invalid IDs return HTTP 400; missing reports return HTTP 404. Updates use a conditional SQL write to detect concurrent status changes.

Unknown `/api/*` routes return JSON HTTP 404. Malformed JSON returns HTTP 400, oversized bodies HTTP 413, and unexpected API failures return a generic HTTP 500 message without a stack trace.

## Automated tests and checks

```powershell
npm run check
npm test
```

The tests use Node's built-in test runner. Database, validation, status-transition, session-signature, configuration, login-rate-limiter, and frontend checks run without Express. HTTP integration tests require both Express and Helmet to resolve; otherwise Node's test runner marks them as skipped with a reason. Skipped tests do not establish runtime behavior. Final Phase 6 audit checks in this environment: `npm run check` passed; `npm test` reported **48 total: 32 passed, 0 failed, 16 skipped**. All 16 skipped tests are HTTP integration tests requiring Express and Helmet, which were unavailable because npm registry access failed with `EAI_AGAIN` resolving `registry.npmjs.org`. Skipped tests are not passed tests. Live HTTP routes, cookie behavior in a browser, and end-to-end browser workflows have not been verified in this environment.

## Project structure

```text
CivicFix/
├── .env.example
├── .gitignore
├── README.md
├── package.json
├── server.js
├── lib/
│   ├── admin-auth.js
│   ├── duplicates.js
│   ├── database.js
│   ├── port.js
│   ├── priority.js
│   ├── status.js
│   └── validation.js
├── public/
│   ├── 404.html
│   ├── app.js
│   ├── index.html
│   └── styles.css
└── tests/
    ├── app.test.js
    ├── phase2.test.js
    └── phase4.test.js
```

## Phase changelog

### Phase 1 — Foundation and responsive UI

Responsive dashboard, navigation, fictional issue tracker, search/filter, Express static serving, health route, Helmet headers, and baseline tests.

### Phase 1 readiness fixes

Added `PORT` validation and clarified that `.env.example` is not automatically loaded. No package lockfile was fabricated when registry access failed.

### Phase 2 — SQLite and public reporting

Added SQLite schema, indexes, one-time fictional seed data, persistent report submission, server-side validation, safe API errors, and API-backed dashboard loading with non-appending static fallback behavior.

### Phase 3 — Administration and access control

Added environment-configured admin sign-in, signed expiring sessions, same-origin checks, bounded in-memory login throttling, server-protected administrative report listing, forward-only status transitions, individual DEMO labels, corrected result counts, and automated status/authentication tests.

### Phase 4 — Prioritization, duplicate candidates and tracking

New report submissions include an explicit impact selection. The server computes and persists priority plus a reason; client-supplied priority values are ignored. Priority is not automatically recalculated on restart or status changes. Existing records retain their priority through migration and receive a migration note rather than being silently reclassified.

Priority rules are deterministic: `minor` → **Low**; `localized` (the safe default if omitted) → **Medium**; `major_access` → **High**; `immediate_safety` → **Critical** with an explicit human-review note. Only the validated impact selection influences priority. Text keywords do not trigger Critical. The selection is a reporter assertion, not a verified assessment, and the result is triage assistance rather than a safety determination.

Duplicate candidates are review suggestions, not confirmed duplicates. Comparison normalizes Unicode text, case, punctuation and whitespace; a candidate must share the category, have an exact or high-overlap location match (token Jaccard ≥ 0.8), and have title/description token Jaccard ≥ 0.35 and at least two distinct shared terms, so one common word alone is insufficient. The API compares each submission against the current report list (including fictional demo rows), performs a full scan, and sorts matches before returning at most five candidates. This is acceptable for the small academic prototype but scales linearly with report count for comparison work, plus sorting matching candidates; no benchmark or accuracy claim is made. Results are limited to five candidates and include reference, title, location, status, similarity score and matching rationale. Reports are saved even when candidates exist; no report is automatically rejected, merged or deleted. The method is heuristic and has no measured accuracy claim.

The SQLite migration expands the allowed priority values to include Critical and adds `impact`, `priority_reason`, and `updated_at`. The migration copies existing IDs, references, statuses, creation timestamps, demo flags and existing priority values transactionally; it does not reseed nonempty databases. Existing priority values are retained rather than recalculated. New report creation stores creation/update timestamps; status changes refresh `updated_at`. Conditional status updates remain in place.

## Verification note

Source checks and dependency-independent tests were executed. Express/Helmet HTTP integration tests remain skipped because those dependencies were unavailable after the documented npm registry DNS/network blocker. Do not claim live Express startup, HTTP integration, cookie handling, or browser testing until those checks run successfully after dependencies are installed during the final execution phase.


### Phase 5 — Stored-data analytics and quality review

The Community Analytics section loads `GET /api/analytics`. The endpoint is public and returns aggregate counts only: total records, counts by status, category and priority, plus a generation timestamp. It does not return report text, references, or locations and does not bypass the administrator-only report management endpoints. The figures are computed from current SQLite records, including clearly labeled fictional seed records; they are not community-wide real-world statistics.

The endpoint uses server-side SQLite `COUNT(*)` and `GROUP BY` queries. Known statuses, categories and priorities are returned with zero counts when absent. An empty database returns a total of zero and zero-count distributions. The frontend displays separate loading, success/empty and error states, offers a refresh control, validates the response shape, and builds list items using safe text APIs. Analytics reload on page initialization, after report submission, and after administrative status updates. Search/filter and report-table behavior remain separate from the aggregate analytics view.

`GET /api/analytics` is intentionally public because its payload contains only aggregate counts, not individual records or protected administrative fields. This is still a local educational prototype: aggregate counts include fictional sample records when the database contains the seed set and must not be interpreted as official municipal data. No external analytics service or charting dependency was added.

### Phase 5 verification status

Run `npm run check` for JavaScript syntax checks and `npm test` for the automated suite. Phase 5 adds database aggregation tests for populated and empty datasets, count consistency after insertion, and frontend loading/error/accessibility structure checks. The two new HTTP integration tests cover populated and empty analytics responses, but they are skipped if Express or Helmet cannot be resolved. In this environment, `EAI_AGAIN` resolving `registry.npmjs.org` and missing Express/Helmet remain blockers; the integration tests are retained and not counted as passed. Live server startup, actual HTTP responses, and browser/assistive-technology behavior remain unverified. No production readiness or municipal integration is claimed.


## Phase 6 final audit and submission status

- Maintained Phases 1–5 source, database logic, UI, API handlers and tests were reviewed together. Changes in this phase are limited to release metadata and documentation; no application redesign or new dependency was introduced.
- `npm run check`: **passed** (exit code 0).
- `npm test`: **48 total, 32 passed, 0 failed, 16 skipped** (exit code 0). The 16 skips are HTTP integration tests, including API/auth/report/status/analytics coverage, because Express and Helmet cannot currently be resolved.
- `npm ping --fetch-timeout=5000 --fetch-retries=0`: **failed** with `EAI_AGAIN` while resolving `registry.npmjs.org`. Dependency installation was not resolved and no lockfile was fabricated.
- Source-level security and data-integrity review is not a substitute for live execution. Server startup, actual HTTP responses, session-cookie behavior, end-to-end browser rendering, responsive behavior on devices, screen-reader/keyboard testing, and deployment are **not verified**.
- `.env.example` contains safe placeholders only. Do not commit `.env`, secrets, or SQLite data. The project is an educational prototype, not a production or municipal service.
- Phase 7 execution, browser verification, GitHub publication and deployment have not started.

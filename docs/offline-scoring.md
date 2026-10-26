# Offline scoring

## Player flow

Sign in online, open Scoreboard, and choose **Enable offline scoring**. Wait for
**Ready for offline scoring** before leaving internet coverage. Preparation needs
a production build, HTTPS (or localhost), IndexedDB, Cache Storage, service workers
and Web Locks. It does not request notification permission or change push keys.

The prepared scoreboard can reopen without internet. It supports manual scoring,
faults, undo, presets, rally timing, draft recovery, and multiple completed matches.
Owned drafts retain their bounded undo history across reloads. A completed result
is frozen; **New match** becomes available after that result commits to device
storage. Queue entries remain separate when another match starts.

The scoreboard shows pending matches and **Sync now**. It automatically attempts
sync while the app is open after completion, reopening, reconnecting, focusing, or
renewing authentication. A cloud save can finish while Progress remains pending;
the queue reports this separately. Open Progress online and use its existing
saved-progress sync control to repair those rewards.

Full History, AI, invitations, and cloud editing remain online features. Voice
recognition may need internet. The worker redirects the app's home launch to the
prepared scoreboard when offline; other offline pages offer a scoreboard link.

## Local data and account ownership

`shuttleboard-offline-v1` is a versioned IndexedDB database containing account IDs
and preparation flags, one active draft per account, immutable result payloads,
receipts, and fenced editor leases. It does not contain copied tokens or passwords.
Authentication continues to use the existing Supabase SDK storage.

An existing unowned draft is offered for explicit adoption. The original key is
retained, and the owned copy commits before adoption is reported as successful.
Lobby setup keys are account-specific and do not overwrite an active scored match.

Signing out stops local access and sync, hides the queue, and retains records for
the same account. Automatic session expiry preserves prepared offline access;
uploads still require fresh server authentication. Explicit sign-out fences stale
authentication callbacks so they cannot silently restore offline access.
Pending local writes settle before the account metadata changes;
draft writes continue to require both the active account and its editor fence.
Another account cannot adopt these owned records through the application. Offline
access is a local device capability, never server authorization. This is browser
storage, not protection against somebody with access to the browser's developer
tools or the same origin's scripts.

Only one tab edits an account's draft. Other tabs show a read-only copy and offer
**Take over scoring**. Leases renew every three seconds and expire after twelve;
after an abrupt close, the next tab may briefly be read-only. Fenced transactions
reject writes from a previous editor after takeover.

**Download unsynced matches** exports JSON containing queued results and the active
draft, including a draft whose latest write failed. No authentication credentials
are exported. Browser-data clearing, private browsing policies, or storage eviction
can remove device-only data. Download a backup before clearing browser data. This
version exports backups; it does not provide a backup-import interface.

## Offline shell and updates

The normal production build emits `offline-scoreboard.html` and a versioned asset
allowlist. A single client entry selects normal SSR hydration or the generic CSR
shell. Both initialize the existing Start function middleware, including attaching
the current session token to server calls.

The existing `/sw.js` registration handles push and offline assets. Preparation
downloads only the generic static shell, required same-origin hashed assets and
public icons, without cookies. It verifies successful responses and expected
script/style/HTML MIME types before replacing its active-cache pointer. Interrupted
or failed staging is removed; the previous working copy remains active. Readiness
checks actual cached assets, not only the account's preparation flag.

API calls, mutations and authenticated HTML are never put in Cache Storage.
Existing tabs can still retrieve their old hashed assets during an update. No
update forces a reload. Old caches are retired on worker activation only when no
document can still import their code. Account drafts and queues are not cache
cleanup targets. Push handlers and subscriptions remain on the same registration.

## Sync and server contract

Completed results carry `client_match_id`, `expected_owner_id`, `started_at` and
`finished_at`. Original play timestamps and duration are frozen before upload.
`expected_owner_id` is only a precondition: the server derives the real owner from
verified authentication and rejects an account change during upload.

The existing match UUID primary key provides duplicate prevention. Creation uses
INSERT, never an overwriting upsert. A duplicate returns only an existing row owned
by the verified actor. History callers that omit the optional offline fields keep
their current save interface. Supplied completed-match timestamps must include
both start and finish; in-progress matches cannot supply a finish time. Timestamps,
offline duration and completed results are checked server-side.

Every finished save, online or offline, must be a result the rules can produce
(`matchResultProblem` in `src/lib/badminton-rules.ts`): each game a reachable final
score for its preset (21-19, 22-20, 30-29, but not 21-20, 22-19 or 31-29), nothing
after the deciding game, and a winner that matches the games. Offline uploads must
also be complete matches; a manually logged single game may stand for a shortened
match. Rejections start with `Validation:`, so a queued match with an impossible
result is marked as an error instead of retried.

The scoreboard keeps which team is at the near end, so the serve check and the
serving court follow the server, and players change ends after each game and at 11
in the deciding game. Every point is a rally for `total_rallies`, timed or not.

One Web Lock per account serializes uploads across tabs. Temporary errors use
exponential backoff capped at five minutes; session checks and uploads share a
twenty-second deadline. Authentication errors pause automatic account uploads until same-account sign-in/token renewal or
an explicit retry. Validation/collision errors stay **Needs attention**, with their
data retained for backup rather than an automatic retry loop. A record is marked
**Synced** only after a matching receipt commits locally. A lost cloud response
therefore retries the same UUID. Replays repair progress but do not repeat
creation-only referral or streak-notification effects.

This feature needs no additional database schema migration: it uses existing match
IDs and timestamp columns. The earlier eight-bug migration remains a separate,
unverified release dependency. Do not apply production migrations as part of this
local work.

## Validation and release gate

Run a normal production build before the production-browser test:

```sh
npm run build
npm test
npm run typecheck
npm run lint
node scripts/check-bugfix-build.mjs
```

Browser tests use separate synthetic contexts and a local fake Supabase service;
external network requests and paid providers are blocked. Coverage includes an
upgrade from an existing push worker, offline reopening with expired authentication,
multiple matches, undo after reload, takeover, a dropped save response and receipt
recovery with exact original play times. Real IndexedDB/Web
Locks tests cover failed/aborted writes, unavailable storage, stale editor fences,
account switching, sign-out/recovery, backoff and retained validation failures.
Worker tests cover incomplete staging, forbidden cache paths and push handling.
These tests do not replace database acceptance.

On October 25, 2026, the complete JavaScript suite passed 188 tests, and the Python
suite passed 99 tests plus the standalone live-transport check. Typecheck and lint
passed, with the three existing Fast Refresh warnings. The production build and
route/bundle smoke checks passed. The browser acceptance run upgraded an existing
push worker and recovered exactly two original matches after a dropped response.
After the Windows restart, the isolated database runner also passed its real-role,
concurrency and transaction assertions. This includes owner-only receipt lookup,
one winner for concurrent UUID inserts, preserved original play times, rejected
cross-account writes and one reward event across repeated calls.

To repeat the isolated database acceptance with Docker Desktop running:

```sh
node tests/database/run-local.mjs
```

That isolated runner also checks real-role match creation, concurrent UUID
collisions, owner-only receipt lookup, original timestamps and repeated reward
events. This database acceptance gate has passed. Production rollout still needs
separate authorization and the earlier bug-fix migration/scheduler release steps;
local database advisors completed with zero errors, 37 performance warnings and
34 informational findings (see `release-review-2026-10-25.md`).
No hosted database, real account, signed-in benchmark, saved comparison build, push
subscription, or published Git history is changed by the test workflow.

For a separately authorized rollout, deploy the normal build and its matching
worker/manifest/assets together. Check the asset manifest and anonymous shell,
prepare the scoreboard on a synthetic account, then test offline reopening before
announcing availability. Do not clear pending queues or account storage during
rollout or rollback. Saved comparison builds remain historical inputs and do not
gain this feature.

# 20 — Notifications over Web Push

Status: Implemented; the owner approved the plan and defaults (2026-11-27)
Updated: 2026-11-27

## Purpose and scope

The owner wants Accanto to tell him when something needs him, as aleph does:
a Routine coming due, Entry schedule items waiting in the inbox, and synced
transactions waiting. This adds the **Notification** and **Device** of
[CONTEXT.md](../../CONTEXT.md). It follows aleph's Home Screen app design
(aleph `docs/tdds/home-screen-app.md` §8): Web Push with a hand-written VAPID
sender, a notifications-only service worker, a preferences row per User and a
send claimed in the database before delivery. Read with the
[constitution](../../CONSTITUTION.md), [TDD 11](11-background-jobs.md) (the
hourly tick), [TDD 13](13-routines.md) and [TDD 18](18-entry-schedules.md).

Excluded: email, ntfy and native apps; notifying the moment something happens
(everything waits for the daily hour); scheduled YNAB sync, so "Transactions
waiting" reminds about items still waiting rather than announcing new ones;
offline caching in the service worker; a per-Entity choice of what to send.

## Decisions

| # | Decision | Why |
| --- | --- | --- |
| D1 | Web Push to the existing web app, installed on the iPhone Home Screen (iOS 16.4+) | No new client or store app; aleph's proven path. Android and desktop browsers work without installing. |
| D2 | Sender in `services/push.py`: RFC 8291 `aes128gcm` encryption and an RFC 8292 VAPID ES256 token, both with `cryptography`; posts with `httpx` | No new dependency (aleph used joserfc for the JWT; a 64-byte ES256 signature is a few lines). Tested against RFC 8291 Appendix A and an independent signature check. |
| D3 | Endpoint allowlist (`push.apple.com`, `fcm.googleapis.com`, `push.services.mozilla.com`, `notify.windows.com` and subdomains, https, no port or userinfo); no redirects or retries | Otherwise registering a Device would let a caller make the server post anywhere. |
| D4 | One hour a day, default 9:00, in each Entity time zone; the first tick at or after it sends | The tick runs about hourly and can drift; quiet by default. |
| D5 | `notification_send (user_id, entity_id, kind, local_date)` primary key inserted before delivery | An overlapping, retried or crashed tick never sends a kind twice that day. A crash after the claim loses that day's notice; that is preferred over a duplicate. |
| D6 | Defaults: Routines due on, Scheduled entries waiting on, Transactions waiting off | Owner, 2026-11-27. A missing row reads as the defaults. |
| D7 | Copy: counts and Routine names only; names flattened to one line of at most 60 characters | Lock screens are public. Constitution §6 for the payload. |
| D8 | Without `VAPID_PRIVATE_KEY` the config route is `404`, Settings hides Notifications and nothing is sent | Kill switch, and no extra configuration for local development. |
| D9 | Preferences per User, not per Entity, covering Entities they own or are a member of (TDD 19); a Notification for a User with several Entities links with `?e=` | One phone, one set of choices; the link still opens the right Entity. |
| D10 | Devices and test sends need a browser session; preferences also accept an API key | A Device is a browser's own subscription. |
| D11 | No MCP or agent tool | Notifications are a User's device settings, not Entity data an agent reads or changes. Recorded here per Constitution §2. |

## Interfaces

- Migration `6y045` (down_revision `6x044`): `push_device`, `notification_preference`,
  `notification_send`. `/readyz` pins `6y045`.
- API: `/api/notifications/{config,preferences,devices,devices/{id},devices/{id}/test}`;
  see [api.md](../api.md#notifications).
- Tick: a third step, `notifications`, after `scheduled_entries` so the day's
  staged items count. Logs `notified`, `delivered` and `not_delivered` only.
- Web: `public/sw.js` (push and notification click, same-origin links only),
  the logo's `manifest.webmanifest` and `public/icons/`, `lib/push.ts`, and a Notifications section in
  Settings: this device (Turn on, Send a test, Turn off, or the Home Screen and
  blocked explanations) and what to send. Permission is requested inside the tap,
  before any await, as iOS requires. The app re-registers its Device on start
  because iOS can drop a subscription silently; signing out removes it.
- Configuration: Box secret `VAPID_PRIVATE_KEY` from `just vapid-keys`.
  `PUSH_RECORD_FILE` (loopback origins only) records payloads for local tests.

## Verification

- Unit `tests/unit/test_notifications.py`: RFC 8291 Appendix A, VAPID claims and
  signature, response mapping (201, 404/410, others), lookalike endpoints, copy and
  defaults.
- Integration `tests/integration/test_notifications.py` (PostgreSQL): defaults,
  `422` hour and endpoint, browser-only Devices, cross-User `404`, the hour, once a
  day, turning a kind on, a gone Device removed, and canary amounts and notes absent
  from payloads. `test_trace_privacy.py` checks the tick's new step logs no canary.
- Frontend `Notifications.test.tsx`: device states, hidden without a key,
  permission before subscribe, refused permission, defaults and save.
- E2E `tests/e2e/test_browser.py`: Turn on in Chromium (permission and
  subscription stubbed in the page), Send a test through the real server and
  sender with payloads recorded to a file, and Turn off.

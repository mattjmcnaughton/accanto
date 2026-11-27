# 21 — Report bug: notes about Accanto, filed in two seconds

Status: Implemented; the owner chose the design (2026-11-27)
Updated: 2026-11-27

## Purpose and scope

The owner keeps finding bugs, ideas and wording fixes while using Accanto and
wants to capture each one without leaving the screen. This adds the **Bug
report** from [CONTEXT.md](../../CONTEXT.md): one line of note, an optional kind
(bug, idea or fix), and diagnostic context taken automatically.

Decided by the owner on 2026-11-27:

- Reports stay in Accanto's database. Nothing is sent to GitHub or any other
  service.
- The feature is on only for Users the operator lists in `REPORT_BUG_EMAILS`;
  at first that is the owner alone.
- A bubble in the bottom-right corner (it grows to "Report bug Ctrl ." on hover)
  and Ctrl/⌘ + . open the form on every screen.

Excluded: screenshots, sending a scrubbed copy to GitHub, and reading reports
through MCP. Each is a later, separate decision.

## Workflows and domain rules

A listed User opens the form with the bubble, Ctrl/⌘ + . or the Ask bar's
"Report bug", types a note, optionally picks a kind (Bug is the default) and
saves with Save or Ctrl/⌘ + Enter. The screen, route and any unsaved edits stay
as they were, and a "Report saved." toast appears. A failed save keeps the note
in the form with a message to try again (Constitution §7). Settings › Report bug
lists the User's reports, newest first, with a status of open, done or won't do.

A Bug report is not financial activity and belongs to the User, not an Entity.

The opt-in is per User and follows the verified sign-in email alone:

- A person created on first sign-in ([TDD 19](19-entity-members.md)) gets the
  flag in the same transaction that creates them, so a listed newcomer sees
  the bubble from their first session and an unlisted one never does.
- Entity membership neither grants nor removes it. An owner who adds a
  member does not give that member Report bug, and a listed member keeps it on
  every Entity they reach, owned or shared. Reports never name or belong to an
  Entity, so a member's reports are invisible to the owner and the reverse.

| Rule | Authoritative source | Commands affected | Enforcement | Verification |
| --- | --- | --- | --- | --- |
| Only a listed User has Report bug; to anyone else it does not exist | This TDD | List, file, change status | Sign-in stores `app_user.report_bug_enabled` from the list; every route checks it and answers 404 | `test_bug_reports.py`: an unlisted User gets 404 on all three routes, and removal from the list takes effect at the next sign-in |
| A User sees and changes only their own reports | Constitution §2 | List, change status | Queries filter on the User; another User's report is 404 | `test_bug_reports.py` |
| The context carries no page content, amounts or names | Constitution §6 | File | The client takes it from an allowlist, never from the page; the API rejects any other field and any value outside fixed patterns (screen names, path templates, codes, class names) with a 422 | `test_bug_reports.py` (six rejected contexts, nothing stored); `ReportBug.test.tsx` (an error message and query values never reach the context) |
| Browser session only | Constitution §2, like API keys | All | `BrowserToken`; an API key gets 403 | `test_bug_reports.py` |

## Implementation and data

- Migration `6z046`: `app_user.report_bug_enabled` (default false) and the
  `bug_report` table (`user_id`, `kind`, `note` up to 2000 characters,
  `context` JSONB, `status`, `created_at`, `resolved_at`, with checks that keep
  `resolved_at` set exactly when the status is not open).
- `config.report_bug_emails`, compared at every sign-in in
  `services/browser_auth.admit_identity`, in the same update that stores the
  User's email; `/api/auth/session` returns `report_bug`.
- `routers/bug_reports.py`, `services/bug_reports.py` and
  `dtos/bug_reports.py`: `GET`, `POST /api/bug-reports` and
  `PATCH /api/bug-reports/{id}` ([api.md](../api.md#report-bug)).
- Frontend: `lib/bugReport.ts` keeps the last 20 API calls (method, path
  template, status, ms, error code) from `fetchJson` and the class names of the
  last 10 uncaught errors, in tab memory only. `features/bugReport/` has the
  bubble and form (a bottom sheet on phones) and the Settings list. The Box
  build sets `VITE_BUILD_SHA` to the deployed commit; without it the build is
  `dev`.
- The note can contain amounts or payees, like an Inbox note. It stays in the
  database and never reaches logs or traces:
  `tests/integration/test_trace_privacy.py` files a report with a canary note.

Interfaces left out, by decision: the agent tool catalog and MCP. Reports are
about the app, not the owner's finances, and an agent reading them would need
a production credential in a code thread (AGENTS.md forbids committing what it
reads). Like API keys, they are browser-only.

## Atomicity, concurrency, and retries

Each command is one transaction that revalidates the session and the User's
flag first. A retried `POST` files a second report; that costs a duplicate
line in a private list, so it takes no idempotency key. A status change sets
the final state, so repeating it is harmless.

## Verification

`tests/integration/test_bug_reports.py` against real Postgres,
`ReportBug.test.tsx` in the frontend unit suite, the trace privacy canary, and
Storybook stories `Shell/Workspace › Report bug`, `› Report bug open` and
`Screens/Settings › With bug reports`. All examples are synthetic.

## Alternatives and tradeoffs

The design spike compared a labelled pill, a bubble and an edge tab; the owner
chose the bubble. Filing straight to GitHub was rejected because the repository
is public and a note can quote a real amount or payee.

## Delivery and compatibility

Additive; `6y045` code never reads the new column or table. Reapply the runtime
grants after upgrading. Set `REPORT_BUG_EMAILS` on the deployment (a JSON list)
and sign in again to see the bubble.

## Open decisions

None blocking. Later: a reviewed, scrubbed copy to GitHub; masked screenshots;
MCP read for the owner's own client.

# 19 — Entity members

Status: Implemented
Updated: 2026-11-27

## Purpose and scope

Two people who share their finances, such as a couple with one "Family" Entity,
each sign in with their own identity and work in the same Entity. Until now an
Entity had exactly one User (`entity.owner_id`) and `authorize()` refused anyone
else. This design adds **Entity members**: the owner adds another provisioned
User by the email they sign in with, and that User then has the owner's access
to the Entity's finances. See the [constitution](../../CONSTITUTION.md) §2
(authorization on every request), [CONTEXT.md](../../CONTEXT.md#actors-and-roles)
and [TDD 04](04-multiple-entities.md).

Excluded: invitations sent by email or link, and an accept step; self-service
sign-up (an operator still allows the email and provisions the User); roles
narrower than full access; transferring ownership; showing who made a change
anywhere in the UI (the audit history records it).

## Workflows and domain rules

- **Add a member.** Actor: the Entity owner, in a signed-in browser. Inputs: the
  email the other User signs in with and a name (1–120 characters, trimmed) the
  owner sees them by. The email is matched, case-insensitively, against the
  verified email stored at each User's latest browser sign-in; it never creates
  or links an identity. Outcome: they see the Entity in their session, marked
  "shared with you", and can use it through every interface. Rejections: no User
  signed in with that email (404 `user_not_found`), more than one did (409
  `ambiguous_email`), the owner or an existing member (409 `already_member`),
  a member or API key attempting it (403 `owner_required` /
  `browser_session_required`), another User's Entity (404 `entity_not_found`).
- **Remove a member / leave.** The owner removes anyone; a member removes only
  their own row. Outcome: the removed person's next request to the Entity is 404
  through every credential they hold. Their own Entities, keys and sessions are
  unaffected.
- **List who shares the Entity.** Owner and members, signed-in browser only.

| Rule (domain name) | Authoritative source | Commands affected | Enforcement | Verification |
| --- | --- | --- | --- | --- |
| A member has the owner's access to the Entity's finances | CONTEXT.md Actors and roles | Every Entity command and read | `authorize()` accepts the owner or a row in `entity_member` | Member creates tags by browser and API key; integration |
| Only the owner adds members or removes others; a member may leave | CONTEXT.md Actors and roles | Add, remove member | `entity_members.owner_only`; remove scoped to the caller's row for a member | Member's add and removal of another row are 403; member leaves; integration |
| Only the owner sets up Transaction sources | This TDD (security review) | Provider token, list plans, connect, accounts, disconnect | `entity_members.require_owner` in `routers/sources.py` | Member's plan list and provider save are 403 `owner_required`; integration |
| Who can open an Entity is managed only from a browser | Constitution §2 (credentials) by analogy | List, add, remove member | `browser_only` | API-key add is 403; integration |
| Removal takes effect on the next request, including one already waiting | Constitution §2 | Every command; assistant reply replay | Membership read after the Entity row lock, in its own statement; `authorize` before following a kept turn | Waiting write is 404 and not applied (fails if the check moves before the lock); replay after removal is 404; integration |
| Every change records who made it | Constitution §1 | Every audited write; add/remove member | Existing `audit_log.actor_id`; `add_member` / `remove_member` audit rows | Audit rows name owner and member; integration |

Failures change nothing.

## Implementation and data

- **Migration `6x044`:** table `entity_member(id, uuid, entity_id, user_id,
  name, created_at)`, unique `(entity_id, user_id)`, index on `user_id`; nullable
  `app_user.email`. The owner stays `entity.owner_id` and is not a row, so
  nothing is backfilled and every existing ownership check keeps meaning
  "owner". `/readyz` pins `6x044`.
- `services/browser_auth.admit_identity` stores the admitted, verified email on
  each sign-in. `account_metadata` lists owned and shared Entities with
  `role: "owner" | "member"`. `services/monthly.authorize` accepts members.
- `services/entity_members` and `routers/entity_members`:
  `GET/POST /api/entities/{id}/members`, `DELETE /api/entities/{id}/members/{member_id}`.
- `bootstrap` accepts no `--entity`, for a User who will only share another
  Entity, and prints the new `user_id`.
- Agent tool catalog and MCP: `get_context` entities carry `role`. Managing
  members is **not** a tool, like credentials: no agent changes who can open an
  Entity (decision recorded here per constitution §2). `list_entities` is unchanged.
- UI: Settings → **Shared with** lists the owner and members with their emails
  and marks "(you)"; the owner sees how-to steps, an add form and Remove with
  confirmation; a member sees Leave. The Entity switcher and command palette mark
  shared Entities. A member sees a note instead of Transaction source setup in
  Settings and the inbox.
- What stays per person: assistant conversations, API keys, sessions and the
  daily assistant cap (all keyed by `user_id`). What stays the owner's: Entry
  schedules stage as the owner (`schedule_actor(owner_id)`), Transaction source
  setup, and the one-YNAB-plan-at-a-time rule over the owner's Entities.
- **Decision (agreed to proceed, revisit if needed):** Agent mode, AGENT.md and
  Pending changes belong to the Entity, so a member can change and apply them
  like the owner. Source setup is owner-only because the saved YNAB token can
  read plans the owner never shared.

## Atomicity, concurrency, and retries

Add and remove run under the Entity row lock with their audit row; a second add
of the same User is refused by the check and the unique constraint. They take no
Idempotency-Key: retrying an add returns `already_member`, retrying a remove
`member_not_found`, and the UI reloads the list after either. Lock order is
unchanged (credential → Entity → User).

## Verification

- `tests/integration/test_entity_members.py` (real PostgreSQL): every rule above.
- `tests/integration/test_browser_auth.py`: session metadata carries `role`;
  sign-in stores the verified email.
- `features/settings/Settings.test.tsx`: owner add by email and remove; member
  sees the list, no add or remove of others, no source setup, and can leave.
- A recorded browser demo with two synthetic identities.

## Alternatives and tradeoffs

- Moving the owner into `entity_member` with a role column would make one source
  of truth, but every `owner_id` use (schedules, YNAB rule, Create Entity) would
  change and need a backfill. Keeping `owner_id` is smaller and reversible.
- Adding by opaque user ID avoided storing emails but was unfriendly. The email
  stored is only the one the provider verified and the allowlist admitted, it is
  refreshed at each sign-in, and it only finds an existing User; identity is
  still issuer and subject.
- An invite the member accepts would stop an owner from adding someone without
  agreement; leaving, plus the "shared with you" marker, is the smaller guard
  while every User is operator-provisioned.

## Delivery and compatibility

Migrate, reapply the runtime grants in [api.md](../api.md) (new table and its
identity sequence; `app_user` already has UPDATE), then deploy. A User can be
added by email only after signing in once on the new code. Rolling back the
application is safe: older code ignores the table and column, so members simply
lose access. The downgrade drops all memberships and stored emails.

## Open decisions

None blocking. Narrower member roles (for example read only), an accept step,
and showing who made a change in Activity are deferred.

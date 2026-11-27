/**
 * Creating a record from the picker that needs it, through the record's existing create command.
 * A Fixed cost has no create command of its own: it is a line of a Plan, so a new one is a new
 * line in a Plan's draft. Saved versions, and the Reviews compared with them, never change.
 */
import type { UUID } from "../../lib/api";
import { destinations } from "../../lib/destinations";
import { type PlanGroup, type PlanRevision, type WriteSpec, monthly } from "../../lib/monthly";
import { type SavingsAccount, savings } from "../../lib/savings";
import { spendingSubcategories } from "../../lib/spendingSubcategories";
import { tags } from "../../lib/tags";
import { parseTimestamp } from "../../lib/timestamp";
import { cleanName, sameName } from "../../ui";
import { type Frequency, planInput, revisionLines } from "../workspace/planWorksheetModel";

export type CreatableKind =
  | "tag"
  | "spending_subcategory"
  | "fixed_cost"
  | "saving_goal"
  | "investment"
  | "giving_recipient";

/** CONTEXT.md's names, as a picker's "New …" note reads them. */
export const NOUNS: Record<CreatableKind, string> = {
  tag: "tag",
  spending_subcategory: "spending subcategory",
  fixed_cost: "fixed cost",
  saving_goal: "saving goal",
  investment: "investment",
  giving_recipient: "giving recipient",
};

export type CreateRequest =
  | { kind: "tag" | "spending_subcategory" | "investment" | "giving_recipient"; name: string }
  /** An ongoing goal with no target: the target, if any, is set later in Savings. */
  | { kind: "saving_goal"; name: string; account: SavingsAccount }
  /** A new line in this Plan's draft, sent with the draft's revision. */
  | {
      kind: "fixed_cost";
      name: string;
      planId: UUID;
      draft: PlanRevision;
      amount: string;
      frequency: Frequency;
    };

/** A goal needs its savings account and a fixed cost its Plan and planned amount; the rest a name. */
export const needsForm = (kind: CreatableKind) => kind === "saving_goal" || kind === "fixed_cost";

export function createSpec(entityId: UUID, request: CreateRequest): WriteSpec<unknown> {
  const name = cleanName(request.name);
  switch (request.kind) {
    case "tag":
      return tags.create(entityId, { name });
    case "spending_subcategory":
      return spendingSubcategories.create(entityId, { name });
    case "investment":
      return destinations.create(entityId, "investment", { name, target: null });
    case "giving_recipient":
      return destinations.create(entityId, "giving", { name, target: null });
    case "saving_goal":
      return savings.addGoal(entityId, request.account.uuid, {
        name,
        kind: "ongoing",
        target: null,
        expected_account_revision: request.account.revision,
      });
    case "fixed_cost":
      // The whole draft goes back as it was, with one line added and no fixed_cost_id, which is
      // how a Plan draft creates a Fixed cost.
      return monthly.editPlan(
        entityId,
        request.planId,
        planInput(
          request.draft.name,
          [
            ...revisionLines(request.draft),
            {
              id: "new-fixed-cost",
              group: "fixed",
              name,
              amount: request.amount.trim(),
              frequency: request.frequency,
            },
          ],
          request.draft.revision,
        ),
      );
  }
}

/** The new record's id in the create command's response. */
export function createdId(request: CreateRequest, data: unknown): UUID | null {
  if (request.kind === "saving_goal") {
    const before = new Set(request.account.goals.map((goal) => goal.uuid));
    return (
      (data as SavingsAccount).goals.find(
        (goal) => !before.has(goal.uuid) && sameName(goal.name, request.name),
      )?.uuid ?? null
    );
  }
  if (request.kind === "fixed_cost") {
    const before = new Set(request.draft.fixed_costs.map((cost) => cost.fixed_cost_id));
    return (
      (data as { draft: PlanRevision }).draft.fixed_costs.find(
        (cost) => !before.has(cost.fixed_cost_id),
      )?.fixed_cost_id ?? null
    );
  }
  return (data as { uuid?: UUID }).uuid ?? null;
}

/**
 * Plan drafts a new Fixed cost can join, as the Plans list orders them: the most recently
 * edited draft first, which is the one offered.
 */
export function planDrafts(plans: PlanGroup[]): Array<{ planId: UUID; draft: PlanRevision }> {
  return plans
    .flatMap((plan) => {
      const draft = plan.revisions.find((revision) => !revision.saved);
      return draft ? [{ planId: plan.plan_id, draft }] : [];
    })
    .sort(
      (a, b) =>
        (parseTimestamp(b.draft.updated_at) ?? 0) - (parseTimestamp(a.draft.updated_at) ?? 0) ||
        a.planId.localeCompare(b.planId),
    );
}

/** Every Fixed cost the Entity's Plans name, once each, for pickers and name checks. */
export function fixedCostsOf(plans: PlanGroup[]) {
  return [
    ...new Map(
      plans.flatMap((plan) =>
        plan.revisions.flatMap((revision) =>
          revision.fixed_costs.map((cost) => [cost.fixed_cost_id, cost] as const),
        ),
      ),
    ).values(),
  ];
}

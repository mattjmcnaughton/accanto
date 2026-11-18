import { USD_AMOUNT } from "../../lib/money";
import type { WriteSpec } from "../../lib/monthly";
import { type Goal, type SavingsAccount, type SavingsMovement, savings } from "../../lib/savings";

/** The one locally edited Savings record. Nothing here is saved until an explicit Save. */
export type OpeningGoalDraft = {
  key: string;
  name: string;
  goalKind: Goal["kind"];
  target: string;
  amount: string;
};
export type Draft =
  | {
      type: "goal";
      account: SavingsAccount;
      goal: Goal;
      name: string;
      goalKind: Goal["kind"];
      target: string;
      active: boolean;
    }
  | {
      type: "new-goal";
      account: SavingsAccount;
      name: string;
      goalKind: Goal["kind"];
      target: string;
    }
  | {
      type: "account";
      account: SavingsAccount;
      name: string;
      date: string;
      amount: string;
      designations: Record<string, string>;
    }
  | {
      type: "new-account";
      name: string;
      date: string;
      amount: string;
      goals: OpeningGoalDraft[];
    }
  | {
      type: "movement";
      movement: SavingsMovement | null;
      action: SavingsMovement["kind"];
      date: string;
      from: string;
      to: string;
      goal: string;
      amount: string;
      note: string;
    };

export type GoalEdit = Extract<Draft, { type: "goal" }>;
export type NewGoalEdit = Extract<Draft, { type: "new-goal" }>;
export type AccountEdit = Extract<Draft, { type: "account" }>;
export type NewAccountEdit = Extract<Draft, { type: "new-account" }>;
export type MovementEdit = Extract<Draft, { type: "movement" }>;

export const dollars = (amount: string) => `$${amount}`;
/** Exact cents for a nonnegative USD input, or null when it is not one. */
export function cents(value: string): number | null {
  if (!USD_AMOUNT.test(value)) return null;
  const [whole, part = ""] = value.split(".");
  return Number(whole) * 100 + Number(part.padEnd(2, "0"));
}
export function formatCents(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
export const hasMoney = (amount: string) => (cents(amount) ?? 0) > 0;

export function draftKey(draft: Draft): string {
  switch (draft.type) {
    case "goal":
      return `g:${draft.goal.uuid}`;
    case "new-goal":
      return `new-goal:${draft.account.uuid}`;
    case "account":
      return `a:${draft.account.uuid}`;
    case "new-account":
      return "new-account";
    case "movement":
      return draft.movement ? `m:${draft.movement.uuid}` : "new-move";
  }
}

export const goalDraft = (account: SavingsAccount, goal: Goal): GoalEdit => ({
  type: "goal",
  account,
  goal,
  name: goal.name,
  goalKind: goal.kind,
  target: goal.target ?? "",
  active: goal.active,
});
export const accountDraft = (account: SavingsAccount): AccountEdit => ({
  type: "account",
  account,
  name: account.name,
  date: account.opening_date,
  amount: account.opening_amount,
  designations: Object.fromEntries(
    account.goals.filter((g) => g.role === "ordinary").map((g) => [g.uuid, g.opening_amount]),
  ),
});
export const movementDraft = (movement: SavingsMovement): MovementEdit => ({
  type: "movement",
  movement,
  action: movement.kind,
  date: movement.date,
  from: movement.from_goal_id ?? "",
  to: movement.to_goal_id ?? "",
  goal: movement.goal_id ?? "",
  // A reconciliation is corrected by entering the known amount, not its stored difference.
  amount: movement.kind === "reconciliation" ? "" : movement.amount,
  note: movement.note,
});

/** True when the draft differs from its saved record; new records are always changes. */
export function changed(draft: Draft): boolean {
  switch (draft.type) {
    case "goal":
      return (
        draft.name !== draft.goal.name ||
        draft.goalKind !== draft.goal.kind ||
        draft.target !== (draft.goal.target ?? "") ||
        draft.active !== draft.goal.active
      );
    case "account": {
      const saved = accountDraft(draft.account);
      return JSON.stringify(saved) !== JSON.stringify(draft);
    }
    case "movement":
      return (
        !draft.movement || JSON.stringify(movementDraft(draft.movement)) !== JSON.stringify(draft)
      );
    default:
      return true;
  }
}

/** Opening money left for Unallocated, in cents; null while an input is not money. */
export function openingRemainder(amount: string, designations: string[]): number | null {
  const total = cents(amount);
  const parts = designations.map(cents);
  if (total === null || parts.some((part) => part === null)) return null;
  return total - parts.reduce<number>((sum, part) => sum + (part ?? 0), 0);
}

function targetProblem(kind: Goal["kind"], target: string): string {
  if (kind === "finite" && !hasMoney(target)) return "A finite goal needs a positive target.";
  if (kind === "ongoing" && target !== "" && !hasMoney(target))
    return "An ongoing target must be blank or positive.";
  return "";
}
const nameProblem = (name: string) =>
  name.trim() && name.trim().length <= 120 ? "" : "Enter a name up to 120 characters.";
const moneyProblem = (amount: string) =>
  cents(amount) === null ? "Enter a USD amount with up to two decimal places." : "";

/** Client-side checks that make the save request meaningful; the backend stays authoritative. */
export function problem(draft: Draft, goalAccount: (goalId: string) => string | undefined): string {
  switch (draft.type) {
    case "goal":
    case "new-goal":
      return nameProblem(draft.name) || targetProblem(draft.goalKind, draft.target);
    case "account":
    case "new-account": {
      const goals =
        draft.type === "new-account"
          ? draft.goals.map((g) => g.amount)
          : Object.values(draft.designations);
      const goalProblem =
        draft.type === "new-account"
          ? draft.goals
              .map((g) => nameProblem(g.name) || targetProblem(g.goalKind, g.target))
              .find(Boolean)
          : "";
      const remainder = openingRemainder(draft.amount, goals);
      return (
        nameProblem(draft.name) ||
        (draft.date ? "" : "Enter an opening date.") ||
        moneyProblem(draft.amount) ||
        goalProblem ||
        (remainder === null
          ? "Enter opening designations as USD amounts."
          : remainder < 0
            ? "Opening designations must fit within the account opening amount."
            : "")
      );
    }
    case "movement": {
      if (!draft.date) return "Enter a financial date.";
      if (draft.note.length > 2000) return "Keep the note within 2000 characters.";
      if (draft.action === "reconciliation")
        return !draft.goal
          ? "Choose the goal to reconcile."
          : cents(draft.amount) === null
            ? "Enter the known saved amount."
            : "";
      if (!draft.from || !draft.to || draft.from === draft.to)
        return "Choose valid, distinct savings goals.";
      const across = goalAccount(draft.from) !== goalAccount(draft.to);
      if (draft.action === "transfer" && !across) return "Choose goals in different accounts.";
      if (draft.action === "reassignment" && across) return "Choose goals in one account.";
      return hasMoney(draft.amount) ? "" : "Enter a positive amount to move.";
    }
  }
}

export function writeFor(entity: string, draft: Draft): WriteSpec<unknown> {
  switch (draft.type) {
    case "goal":
      return savings.editGoal(entity, draft.account.uuid, draft.goal.uuid, {
        name: draft.name.trim(),
        kind: draft.goalKind,
        target: draft.target || null,
        active: draft.active,
        expected_revision: draft.goal.revision,
      });
    case "new-goal":
      return savings.addGoal(entity, draft.account.uuid, {
        name: draft.name.trim(),
        kind: draft.goalKind,
        target: draft.target || null,
        expected_account_revision: draft.account.revision,
      });
    case "account":
      return savings.edit(entity, draft.account.uuid, {
        name: draft.name.trim(),
        opening_date: draft.date,
        opening_amount: draft.amount,
        expected_revision: draft.account.revision,
        designations: Object.entries(draft.designations).map(([goal_id, opening_amount]) => ({
          goal_id,
          opening_amount,
        })),
      });
    case "new-account":
      return savings.create(entity, {
        name: draft.name.trim(),
        opening_date: draft.date,
        opening_amount: draft.amount,
        goals: draft.goals.map((g) => ({
          name: g.name.trim(),
          kind: g.goalKind,
          target: g.target || null,
          opening_amount: g.amount,
        })),
      });
    case "movement": {
      const body =
        draft.action === "reconciliation"
          ? {
              kind: draft.action,
              date: draft.date,
              goal_id: draft.goal,
              known_amount: draft.amount,
              note: draft.note,
            }
          : {
              kind: draft.action,
              date: draft.date,
              from_goal_id: draft.from,
              to_goal_id: draft.to,
              amount: draft.amount,
              note: draft.note,
            };
      return draft.movement
        ? savings.correctMovement(entity, draft.movement.uuid, {
            ...body,
            expected_revision: draft.movement.revision,
          })
        : savings.move(entity, body);
    }
  }
}

import { expect, test } from "vitest";
import { monthly } from "./monthly";

test("monthly write contracts use scoped UUID routes and preserve decimal strings", () => {
  expect(
    monthly.createActivity("entity-uuid", {
      date: "2026-10-15",
      category: "spending",
      amount: "75.00",
    }),
  ).toEqual({
    method: "POST",
    path: "/api/entities/entity-uuid/activity",
    body: { date: "2026-10-15", category: "spending", amount: "75.00" },
  });
  expect(monthly.saveVersion("entity-uuid", "plan-uuid", { expected_revision: 2 }).path).toBe(
    "/api/entities/entity-uuid/plans/plan-uuid/versions",
  );
  expect(monthly.deleteActivity("entity-uuid", "entry-uuid", { expected_revision: 3 }).method).toBe(
    "DELETE",
  );
});

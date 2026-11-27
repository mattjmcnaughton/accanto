/**
 * One set of MSW handlers for every story. Each API read the screens make is a named resource,
 * and a story picks a state for all of them or for some:
 *
 *   parameters: { msw: mockApi() }                       // every read returns the fixtures
 *   parameters: { msw: mockApi("empty") }                // every list is empty
 *   parameters: { msw: mockApi("loaded", { plans: "failed" }) }
 *   parameters: { msw: mockApi("loaded", { plans: [] }) } // any other value is the response body
 */
import { http, HttpResponse, delay } from "msw";
import { fn } from "storybook/test";
import type { ScreenProps } from "../../features/workspace/shared";
import { activityPage } from "./activity";
import * as data from "./fixtures";
import { payoffSchedules } from "./loans";
import * as projection from "./projections";
import { routineList } from "./routines";
import { scheduleList } from "./schedules";

export { data, projection };
export type State = "loaded" | "empty" | "loading" | "failed";

const entity = "/api/entities/:entity";
// A Review that does not exist is a 404 with this code, which screens treat as empty.
const missingReview = () =>
  HttpResponse.json(
    { detail: { code: "review_not_found", message: "No Review for this month yet." } },
    { status: 404 },
  );
const resources = {
  session: { path: "/api/auth/session", loaded: data.session, empty: data.session },
  settings: { path: `${entity}/settings`, loaded: data.settings, empty: data.settings },
  apiKeys: { path: "/api/keys", loaded: data.apiKeys, empty: [] },
  bugReports: { path: "/api/bug-reports", loaded: data.bugReports, empty: [] },
  agentSettings: {
    path: `${entity}/agent/settings`,
    loaded: data.agentSettings,
    empty: data.agentSettings,
  },
  plans: { path: `${entity}/plans`, loaded: data.plans, empty: [] },
  activity: { path: `${entity}/activity`, loaded: data.activity, empty: [] },
  reviews: { path: `${entity}/reviews/:month`, loaded: data.reviews, empty: {} },
  savingsAccounts: {
    path: `${entity}/savings-accounts`,
    loaded: data.savingsAccounts,
    empty: [],
  },
  savingsMovements: {
    path: `${entity}/savings-accounts/movements`,
    loaded: data.savingsMovements,
    empty: [],
  },
  investments: { path: `${entity}/investments`, loaded: data.investments, empty: [] },
  givingRecipients: {
    path: `${entity}/giving-recipients`,
    loaded: data.givingRecipients,
    empty: [],
  },
  investmentActivity: {
    path: `${entity}/investment-activity`,
    loaded: data.investmentActivity,
    empty: [],
  },
  givingActivity: { path: `${entity}/giving-activity`, loaded: data.givingActivity, empty: [] },
  loans: { path: `${entity}/debts`, loaded: data.loans, empty: [] },
  payoffSchedules: {
    path: `${entity}/debts/:debt/payoff-schedule`,
    loaded: payoffSchedules,
    empty: {},
  },
  debtObservations: {
    path: `${entity}/debt-observations`,
    loaded: data.debtObservations,
    empty: [],
  },
  investmentObservations: {
    path: `${entity}/investment-observations`,
    loaded: data.investmentObservations,
    empty: [],
  },
  routines: { path: `${entity}/routines`, loaded: routineList(), empty: [] },
  schedules: { path: `${entity}/schedules`, loaded: scheduleList(), empty: [] },
  tags: { path: `${entity}/tags`, loaded: data.tags, empty: [] },
  spendingSubcategories: {
    path: `${entity}/spending-subcategories`,
    loaded: data.spendingSubcategories,
    empty: [],
  },
  projections: {
    path: `${entity}/projections`,
    loaded: projection.projections,
    empty: Object.fromEntries(
      ["10", "20", "30"].flatMap((y) =>
        ["today", "future"].map((d) => [`${y}:${d}`, { investments: [] }]),
      ),
    ),
  },
  fireAssumptions: {
    path: `${entity}/fire-assumptions`,
    loaded: projection.fireAssumptions,
    empty: projection.noFireAssumptions,
  },
  // Inbox stories put the stateful handlers of mocks/inbox.ts first; these cover other states.
  inbox: { path: `${entity}/inbox`, loaded: [], empty: [] },
  sources: { path: `${entity}/sources`, loaded: [], empty: [] },
  transactionProvider: {
    path: `${entity}/transaction-provider`,
    loaded: { kind: "ynab", configured: true, revision: 1 },
    empty: { kind: null, configured: false, revision: 0 },
  },
} satisfies Record<string, { path: string; loaded: unknown; empty: unknown }>;
export type Resource = keyof typeof resources;

const outage = () =>
  HttpResponse.json(
    { detail: { code: "unavailable", message: "Synthetic outage: the server did not answer." } },
    { status: 503 },
  );
function reader(resource: Resource, choice: State | unknown) {
  const { path, ...bodies } = resources[resource];
  return http.get(path, async ({ params, request }) => {
    if (choice === "loading") await delay("infinite");
    if (choice === "failed") return outage();
    const body = choice === "loaded" || choice === "empty" ? bodies[choice] : choice;
    // Projections are keyed by the requested horizon in years and dollars.
    if (resource === "projections") {
      const query = new URL(request.url).searchParams;
      const key = `${query.get("years") ?? "20"}:${query.get("dollars") ?? "today"}`;
      return HttpResponse.json((body as Record<string, object>)[key]);
    }
    // Payoff schedules are keyed by loan.
    if (resource === "payoffSchedules")
      return HttpResponse.json((body as Record<string, object>)[String(params.debt)] ?? {});
    if (resource !== "reviews") return HttpResponse.json(body as object);
    const review = (body as Record<string, unknown>)[String(params.month)];
    return review ? HttpResponse.json(review) : missingReview();
  });
}

/** Activity's pages come from the same entries as its full list. */
function activityPages(choice: State | unknown) {
  return http.get(`${entity}/activity/page`, async ({ request }) => {
    if (choice === "loading") await delay("infinite");
    if (choice === "failed") return outage();
    const body = choice === "loaded" || choice === "empty" ? resources.activity[choice] : choice;
    return HttpResponse.json(activityPage(request.url, body as Parameters<typeof activityPage>[1]));
  });
}

// Screens save through the `save` prop, so only Settings' API keys write through fetch.
const writes = [
  http.post("/api/keys", () => HttpResponse.json({ key: "acc_synthetic_storybook_key" })),
  http.delete("/api/keys/:id", () => new HttpResponse(null, { status: 204 })),
  http.post("/api/bug-reports", async () => {
    await delay(300);
    return HttpResponse.json({ ...data.bugReports[0], id: "8d4c3f5b-0e6a-4b9d-8f1e-4a5b6c7d8e9f" });
  }),
  http.patch("/api/bug-reports/:id", async ({ params, request }) =>
    HttpResponse.json({
      ...(data.bugReports.find((r) => r.id === params.id) ?? data.bugReports[0]),
      ...((await request.json()) as object),
    }),
  ),
  http.put(`${entity}/fire-assumptions`, async ({ request }) =>
    HttpResponse.json({ ...((await request.json()) as object), revision: 3 }),
  ),
  http.put(`${entity}/transaction-provider`, async () => {
    await delay(600);
    return HttpResponse.json({ kind: "ynab", configured: true, revision: 1 });
  }),
];

export function mockApi(
  state: State = "loaded",
  overrides: Partial<Record<Resource, State | unknown>> = {},
) {
  return [
    activityPages(overrides.activity ?? state),
    ...(Object.keys(resources) as Resource[]).map((resource) =>
      reader(resource, overrides[resource] ?? state),
    ),
    ...writes,
  ];
}

/** A story that renders its component with every API read in one state. */
export const stateStory = (state: State) => ({ parameters: { msw: mockApi(state) } });

/** The props Workspace passes every screen, with callbacks recorded in the Actions panel. */
export const screenArgs = (): ScreenProps => ({
  entity: data.entity,
  concealed: false,
  busy: false,
  refresh: 0,
  guard: fn(() => true).mockName("guard"),
  dirty: fn().mockName("dirty"),
  save: fn().mockName("save"),
});

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
import * as data from "./fixtures";

export { data };
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
  incomeEstimates: { path: `${entity}/income-estimates`, loaded: data.incomeEstimates, empty: [] },
  // Inbox stories put the stateful handlers of mocks/inbox.ts first; these cover other states.
  inbox: { path: `${entity}/inbox`, loaded: [], empty: [] },
  sources: { path: `${entity}/sources`, loaded: [], empty: [] },
} satisfies Record<string, { path: string; loaded: unknown; empty: unknown }>;
export type Resource = keyof typeof resources;

function reader(resource: Resource, choice: State | unknown) {
  const { path, ...bodies } = resources[resource];
  return http.get(path, async ({ params }) => {
    if (choice === "loading") await delay("infinite");
    if (choice === "failed")
      return HttpResponse.json(
        {
          detail: { code: "unavailable", message: "Synthetic outage: the server did not answer." },
        },
        { status: 503 },
      );
    const body = choice === "loaded" || choice === "empty" ? bodies[choice] : choice;
    if (resource !== "reviews") return HttpResponse.json(body as object);
    const review = (body as Record<string, unknown>)[String(params.month)];
    return review ? HttpResponse.json(review) : missingReview();
  });
}

// Screens save through the `save` prop, so only Settings' API keys write through fetch.
const writes = [
  http.post("/api/keys", () => HttpResponse.json({ key: "acc_synthetic_storybook_key" })),
  http.delete("/api/keys/:id", () => new HttpResponse(null, { status: 204 })),
];

export function mockApi(
  state: State = "loaded",
  overrides: Partial<Record<Resource, State | unknown>> = {},
) {
  return [
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
  entity: data.session.entities[0],
  concealed: false,
  busy: false,
  refresh: 0,
  guard: fn(() => true).mockName("guard"),
  dirty: fn().mockName("dirty"),
  save: fn().mockName("save"),
});

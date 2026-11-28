import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Plans } from "../../features/workspace/Plans";
import { mockApi, projection, screenArgs, stateStory } from "../mocks/api";
import { routinesApi } from "../mocks/routines";
import { alertList } from "../mocks/spendingAlerts";

// Home is the Plans screen with `home` set, as Workspace renders it.
const meta = {
  title: "Screens/Home",
  component: Plans,
  args: {
    ...screenArgs(),
    home: true,
    visible: true,
    showPlans: fn().mockName("showPlans"),
    go: fn().mockName("go"),
    openRoutine: fn().mockName("openRoutine"),
  },
} satisfies Meta<typeof Plans>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};
/** An active investment with no observation: net worth and its projection stay unknown. */
export const NetWorthUnknown: Story = {
  parameters: { msw: mockApi("loaded", { projections: projection.projectionsUnknown }) },
};
/** A past month chosen in the top bar: its figures, without today's pace marker. */
export const AnotherMonth: Story = { args: { month: "2026-09" } };
export const LoadedPhone: Story = { globals: { viewport: { value: "phone", isRotated: false } } };
/** Due and overdue routines lead Needs you, one line each; a line opens the occurrence. */
export const RoutineDueToday: Story = {
  parameters: { msw: [...routinesApi({ dueToday: true }).handlers, ...mockApi()] },
};
/** Nothing due: no routine appears on Home. */
export const RoutinesCaughtUp: Story = {
  parameters: { msw: [...routinesApi({ allDone: true }).handlers, ...mockApi()] },
};
/** Spending alerts past a threshold lead with amounts; a dismissed one (Rent) stays hidden. */
export const SpendingAlertReached: Story = {
  parameters: { msw: mockApi("loaded", { spendingAlerts: alertList("reached") }) },
};
/** Past 100% of an estimate: the mark turns red and the line says how much over. */
export const SpendingAlertOverspent: Story = {
  parameters: { msw: mockApi("loaded", { spendingAlerts: alertList("overspent") }) },
};
/** No threshold reached: no spending alert on Home. */
export const SpendingAlertsQuiet: Story = {
  parameters: { msw: mockApi("loaded", { spendingAlerts: alertList("quiet") }) },
};
export const Empty: Story = stateStory("empty");
export const Loading: Story = stateStory("loading");
export const Failed: Story = stateStory("failed");

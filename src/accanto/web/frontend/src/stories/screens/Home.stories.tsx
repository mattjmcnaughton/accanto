import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Plans } from "../../features/workspace/Plans";
import { mockApi, projection, screenArgs, stateStory } from "../mocks/api";
import { routinesApi } from "../mocks/routines";

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
export const Empty: Story = stateStory("empty");
export const Loading: Story = stateStory("loading");
export const Failed: Story = stateStory("failed");

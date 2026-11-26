import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { Routines } from "../../features/routines/Routines";
import { data, mockApi, screenArgs, stateStory } from "../mocks/api";
import { ROUTINE_IDS, routinesApi } from "../mocks/routines";

/**
 * Routines over a stateful synthetic set: ticking, skipping and notes persist until the story
 * reloads. Today is Tue Nov 10, 2026; the Saturday routine for Nov 7 is three days overdue.
 */
const api = routinesApi();
const meta = {
  title: "Screens/Routines",
  component: Routines,
  args: {
    ...screenArgs(),
    credentials: fn(async () => data.session).mockName("credentials"),
    open: fn().mockName("open"),
  },
  parameters: { layout: "padded", msw: [...api.handlers, ...mockApi()] },
  beforeEach: () => api.reset(),
} satisfies Meta<typeof Routines>;
export default meta;
type Story = StoryObj<typeof meta>;

const phone = { globals: { viewport: { value: "phone", isRotated: false } } };
const run = (on: string) => ({ start: { routine: ROUTINE_IDS.saturday, on } });
const click = (name: string | RegExp, index = 0) =>
  (async ({ canvasElement }) => {
    const buttons = await within(canvasElement).findAllByRole("button", { name });
    await userEvent.click(buttons[index]);
  }) satisfies Story["play"];

/** The list: cadence, what the current occurrence needs, and the last 12 as dots. */
export const List: Story = {};
export const ListPhone: Story = { ...phone };

/** An overdue occurrence with one step ticked. Tick, skip and add notes; the bar follows. */
export const Run: Story = { args: run("2026-11-07") };
export const RunPhone: Story = { ...phone, args: run("2026-11-07") };
/** Every step ticked: the occurrence is done. */
export const RunDone: Story = {
  args: run("2026-11-07"),
  parameters: { msw: [...routinesApi({ allDone: true }).handlers, ...mockApi()] },
};
/** A missed week, opened from a history dot: it can still be finished, late. */
export const RunMissed: Story = { args: run("2026-09-05") };
/** A skipped week keeps its note and can be reopened. */
export const RunSkipped: Story = { args: run("2026-10-24") };

/** New routine: cadence and steps, each with an optional screen or website link. */
export const Create: Story = { play: click("New routine") };
export const CreatePhone: Story = { ...phone, play: click("New routine") };
/** Editing the Saturday routine. */
export const Edit: Story = { play: click("Edit") };
export const EditPhone: Story = { ...phone, play: click("Edit") };
/** The monthly cadence: a day of the month, or the nth weekday. */
export const EditMonthly: Story = { play: click("Edit", 1) };

export const Empty: Story = stateStory("empty");
export const Loading: Story = stateStory("loading");
export const Failed: Story = stateStory("failed");

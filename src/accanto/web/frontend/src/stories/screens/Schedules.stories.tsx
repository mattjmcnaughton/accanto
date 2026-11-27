import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { Schedules } from "../../features/schedules/Schedules";
import { mockApi, screenArgs, stateStory } from "../mocks/api";

/**
 * Scheduled entries over a synthetic set. Today is Tue Nov 10, 2026: the payroll schedule
 * arrives in the inbox on the last weekday of each month and skips Dec 31 once; the index fund buy failed
 * for Oct 15 (not enough saved); the kitchen donation is paused; the loan payment ended.
 */
const meta = {
  title: "Screens/Schedules",
  component: Schedules,
  args: screenArgs(),
  parameters: { layout: "padded", msw: mockApi() },
} satisfies Meta<typeof Schedules>;
export default meta;
type Story = StoryObj<typeof meta>;

const phone = { globals: { viewport: { value: "phone", isRotated: false } } };
const click = (name: string | RegExp, index = 0) =>
  (async ({ canvasElement }) => {
    const buttons = await within(canvasElement).findAllByRole("button", { name });
    await userEvent.click(buttons[index]);
  }) satisfies Story["play"];

/** Every schedule: its entries, next date, upcoming dates to skip once, and failures. */
export const List: Story = {};
export const ListPhone: Story = { ...phone };

/** A new schedule starts as the last weekday of each month, with one income entry. */
export const Create: Story = { play: click("New schedule") };
export const CreatePhone: Story = { ...phone, play: click("New schedule") };
/** Editing the payroll schedule: income to Primary pay and the matching investment. */
export const Edit: Story = { play: click("Edit") };
export const EditPhone: Story = { ...phone, play: click("Edit") };
/** Saving with missing amounts and lines shows each problem in place. */
export const CreateErrors: Story = {
  play: async (context) => {
    await click("New schedule")(context);
    await click("Create schedule")(context);
  },
};

export const Empty: Story = stateStory("empty");
export const Loading: Story = stateStory("loading");
export const Failed: Story = stateStory("failed");

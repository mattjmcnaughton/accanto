import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { Alerts } from "../../features/alerts/Alerts";
import { mockApi, screenArgs, stateStory } from "../mocks/api";
import { alertList } from "../mocks/spendingAlerts";

/**
 * Spending alerts in November 2026 against the synthetic "Everyday balance" version 1: guilt-
 * free spending past 70%, Eating out against its estimate, Books waiting and Rent at 100%.
 */
const meta = {
  title: "Screens/Alerts",
  component: Alerts,
  args: screenArgs(),
  parameters: { layout: "padded", msw: mockApi() },
} satisfies Meta<typeof Alerts>;
export default meta;
type Story = StoryObj<typeof meta>;

const phone = { globals: { viewport: { value: "phone", isRotated: false } } };
const click = (name: string | RegExp, index = 0) =>
  (async ({ canvasElement }) => {
    const buttons = await within(canvasElement).findAllByRole("button", { name });
    await userEvent.click(buttons[index]);
  }) satisfies Story["play"];

export const List: Story = {};
export const ListPhone: Story = { ...phone };
/** Eating out past 100% of its estimate, at 125%. */
export const Overspent: Story = {
  parameters: { msw: mockApi("loaded", { spendingAlerts: alertList("overspent") }) },
};
export const New: Story = { play: click("New alert") };
export const Edit: Story = { play: click(/^Edit Eating out/) };
export const EditPhone: Story = { ...phone, play: click(/^Edit Eating out/) };
export const Empty: Story = stateStory("empty");
export const Loading: Story = stateStory("loading");
export const Failed: Story = stateStory("failed");

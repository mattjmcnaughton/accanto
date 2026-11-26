import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import {
  AmountInput,
  Band,
  Dialog,
  Empty,
  Field,
  Head,
  Icon,
  Meter,
  Skeleton,
  Spark,
  Trend,
} from "../../ui";

// One file for the redesign kit; each export is one component. All amounts are synthetic.
const meta = { title: "Kit", parameters: { layout: "padded" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const icons = [
  "home",
  "activity",
  "review",
  "plans",
  "savings",
  "investments",
  "giving",
  "loans",
  "settings",
  "search",
  "plus",
  "x",
  "left",
  "right",
  "down",
  "more",
  "trash",
  "copy",
];
export const Icons: Story = {
  render: () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 7rem)", gap: 12 }}>
      {icons.map((name) => (
        <span key={name} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Icon name={name} /> {name}
        </span>
      ))}
    </div>
  ),
};

const parts = [
  { key: "fixed", kind: "fixed", weight: 2480, fill: 1, title: "Fixed costs $2,480.02" },
  { key: "free", kind: "free", weight: 1720, fill: 0.6, title: "Spending $1,719.98" },
  { key: "save", kind: "save", weight: 1000, fill: 0.5, hatch: 0.5, title: "Saving $1,000.00" },
  { key: "invest", kind: "invest", weight: 1000, fill: 0, title: "Investing $1,000.00" },
  { key: "give", kind: "give", weight: 600, fill: 1, title: "Giving $600.00" },
];
export const AllocationBand: Story = {
  name: "Band",
  render: () => (
    <div style={{ display: "grid", gap: 32 }}>
      <Band parts={parts} label="Synthetic monthly allocation" />
      <Band
        parts={[...parts, { key: "none", kind: "none", weight: 400, title: "Unassigned $400.00" }]}
        label="Allocation with unassigned money and a funding limit"
        limit={0.85}
      />
    </div>
  ),
};

export const Meters: Story = {
  name: "Meter",
  render: () => (
    <div style={{ display: "grid", gap: 12, maxWidth: 320 }}>
      <Meter value={1500} max={4000} kind="save" />
      <Meter value={4000} max={4000} kind="invest" />
      <Meter value={250} max={1000} kind="give" faint />
      <Meter value={0} max={0} kind="none" />
    </div>
  ),
};

export const Sparkline: Story = {
  name: "Spark",
  render: () => (
    <div style={{ maxWidth: 200 }}>
      <Spark values={[120, 180, 150, 240, 210, 300]} kind="income" />
    </div>
  ),
};

export const TrendChart: Story = {
  name: "Trend",
  render: () => (
    <div style={{ maxWidth: 360 }}>
      <Trend
        label="Synthetic loan balance"
        kind="fixed"
        points={[
          { date: "2026-08-01", value: 1_800_000 },
          { date: "2026-09-01", value: 1_765_000 },
          { date: "2026-10-01", value: 1_731_500 },
          { date: "2026-11-01", value: 1_698_000 },
        ]}
      />
    </div>
  ),
};

const closeDialog = fn().mockName("onClose");
export const DialogOpen: Story = {
  name: "Dialog",
  render: () => (
    <Dialog title="Record an entry" onClose={closeDialog}>
      <div style={{ display: "grid", gap: 12, padding: 16 }}>
        <Field label="Note">
          <input defaultValue="Synthetic groceries" />
        </Field>
        <button type="button" className="btn primary">
          Save
        </button>
      </div>
    </Dialog>
  ),
};

export const Fields: Story = {
  name: "Field",
  render: () => (
    <div style={{ display: "grid", gap: 12, maxWidth: 320 }}>
      <Field label="Plan name">
        <input defaultValue="Everyday balance" />
      </Field>
      <Field label="Monthly amount" hint="Up to two decimals.">
        <input inputMode="decimal" defaultValue="250.00" />
      </Field>
    </div>
  ),
};

export const EmptyState: Story = {
  name: "Empty",
  render: () => (
    <Empty
      title="No Plans yet"
      action={
        <button type="button" className="btn primary">
          Create a Plan
        </button>
      }
    >
      A Plan divides one month of income between fixed costs, spending, saving, investing and
      giving.
    </Empty>
  ),
};

export const Header: Story = {
  name: "Head",
  render: () => (
    <Head title="Savings" sub="Three accounts, $16,100.00 saved">
      <button type="button" className="btn">
        Move money
      </button>
      <button type="button" className="btn primary">
        <Icon name="plus" /> New account
      </button>
    </Head>
  ),
};

function AmountGrid() {
  const [cents, setCents] = useState([210000, 26000, 12002]);
  return (
    <div data-grid style={{ display: "grid", gap: 8, maxWidth: 200 }}>
      {cents.map((value, index) => (
        <AmountInput
          // biome-ignore lint/suspicious/noArrayIndexKey: A fixed list of three cells.
          key={index}
          label={`Amount ${index + 1}`}
          cents={value}
          onCommit={(next) => setCents((all) => all.map((v, i) => (i === index ? next : v)))}
        />
      ))}
      <AmountInput label="Disabled amount" cents={5000} onCommit={() => {}} disabled />
      <output>Total {(cents.reduce((a, b) => a + b, 0) / 100).toFixed(2)}</output>
    </div>
  );
}
export const Amounts: Story = { name: "AmountInput", render: () => <AmountGrid /> };

export const Loading: Story = { name: "Skeleton", render: () => <Skeleton /> };

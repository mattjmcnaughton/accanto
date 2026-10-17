import { expect, test } from "@playwright/test";

test("complete prototype workflow, corrections, history and mobile", async ({ page }) => {
  page.on("pageerror", (error) => console.error(error.message));
  await page.goto("/#/?view=plans&month=2026-10");
  await page.evaluate(() =>
    localStorage.setItem(
      "accanto-workspace-prototype-v1",
      JSON.stringify({
        schema: 1,
        name: "My entity",
        plans: [],
        goals: [
          {
            id: "emergency",
            accountId: "a",
            purpose: "finite",
            role: "ordinary",
            name: "Emergency fund",
            target: 2000000,
            tag: "Household savings",
            active: true,
          },
          {
            id: "unallocated",
            name: "Unallocated",
            target: 0,
            tag: "",
            active: true,
            accountId: "a",
            purpose: "ongoing",
            role: "unallocated",
            opening: 0,
          },
        ],
        accounts: [{ id: "a", name: "Savings", date: "2026-01-01", opening: 0, active: true }],
        investments: [{ id: "retirement", name: "Retirement", target: null, active: true }],
        recipients: [],
        entries: [],
        reviews: [],
        balances: [],
      }),
    ),
  );
  await page.reload();
  await page.getByRole("button", { name: "Create your first Plan" }).click();
  await page.getByLabel("Plan name", { exact: true }).fill("Ordinary month");
  await page.getByRole("button", { name: "Add Income source", exact: true }).click();
  await page.getByLabel("Income source 1 name").fill("Salary");
  await page.getByLabel("Monthly net income", { exact: true }).fill("5500");
  await page.getByRole("button", { name: "Add fixed cost", exact: true }).click();
  await page.getByLabel("Category", { exact: true }).fill("Housing");
  await page.getByLabel("Amount", { exact: true }).fill("1800");
  await page.getByLabel("Guilt-free spending / month", { exact: true }).fill("900");
  await page.getByLabel("Add saving goal allocation", { exact: true }).selectOption("emergency");
  await page.getByLabel("Emergency fund / month", { exact: true }).fill("700");
  await page.getByLabel("Add investment allocation", { exact: true }).selectOption("retirement");
  await page.getByLabel("Retirement / month", { exact: true }).fill("900");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "/tmp/accanto-prototype-plan-editor.png", fullPage: true });
  await page.getByRole("button", { name: "Save version 1", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Ordinary month", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Month", exact: true }).click();
  await page.getByRole("button", { name: "Start monthly Review" }).click();
  await page.getByLabel("Saved Plan version").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Start Review", exact: true }).click();
  await expect(page.getByText("0 of 6 totals recorded")).toBeVisible();
  await page.getByRole("button", { name: "Inspect Take-home income actual", exact: true }).click();
  await expect(page.getByText("No dated entries for this item.")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  async function add(type: string, amount: string, note: string, source?: string) {
    await page.getByRole("button", { name: "Add entry N", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Add entry", exact: true })).toBeVisible({
      timeout: 5000,
    });
    await page.getByRole("combobox", { name: "Type", exact: true }).selectOption(type);
    if (source) await page.locator("dialog select").nth(1).selectOption({ label: source });
    await page.getByLabel("Amount", { exact: true }).fill(amount);
    await page.getByLabel("Date", { exact: true }).fill("2026-10-11");
    await page.getByLabel("Note", { exact: false }).fill(note);
    await page.getByRole("button", { name: "Record entry", exact: true }).click();
  }
  await add("income", "5500", "October salary", "Salary");
  await add("fixed", "1800", "October rent", "Housing");
  await add("giving", "550", "Monthly giving");
  await add("spending", "210.45", "Dinner and a concert");
  await add("saving", "700", "Emergency fund contribution", "Emergency fund");
  await add("investing", "900", "Monthly investment", "Retirement");
  await add("income", "500", "Unplanned freelance work");
  await add("fixed", "40", "Unexpected repair");
  await page.getByRole("link", { name: "Month", exact: true }).click();
  await expect(page.getByText("6 of 6 totals recorded")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Inspect Take-home income actual", exact: true }),
  ).toHaveText("$6,000");
  await expect(
    page.getByRole("button", { name: "Inspect Fixed costs actual", exact: true }),
  ).toHaveText("$1,840");
  await page.screenshot({ path: "/tmp/accanto-prototype-month.png", fullPage: true });
  await page
    .getByRole("button", { name: "Inspect Guilt-free spending actual", exact: true })
    .click();
  await page.getByLabel("Known total", { exact: true }).fill("250");
  await expect(page.getByText(/Adjustment:.*39.55/)).toBeVisible();
  await page.getByRole("button", { name: "Add adjustment", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Inspect Guilt-free spending actual", exact: true }),
  ).toHaveText("$250");
  await page.reload();
  await page
    .getByRole("button", { name: "Inspect Guilt-free spending actual", exact: true })
    .click();
  await page.getByRole("button", { name: /Adjustment to recorded total/ }).click();
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("39.55");
  await page.getByRole("button", { name: "Delete entry", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Inspect Guilt-free spending actual", exact: true }),
  ).toHaveText("$210.45");
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await page.getByLabel("Search activity", { exact: true }).fill("concert");
  await page.getByRole("button", { name: "Dinner and a concert", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("220.45");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("$220.45", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Dinner and a concert", exact: true }).click();
  await page.getByRole("button", { name: "Delete entry", exact: true }).click();
  await expect(page.getByText("No entries match these filters.")).toBeVisible();
  await page.getByRole("button", { name: "Undo delete", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Dinner and a concert", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Plans", exact: true }).click();
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  await page.getByLabel("Guilt-free spending / month", { exact: true }).fill("1000");
  await page.getByRole("button", { name: "Save version 2", exact: true }).first().click();
  await page.getByRole("link", { name: "Month", exact: true }).click();
  await expect(page.getByRole("button", { name: /Ordinary month v1/ })).toBeVisible();
  await page.getByRole("button", { name: /Ordinary month v1/ }).click();
  await page
    .getByRole("combobox", { name: "Saved Plan version" })
    .selectOption({ label: "Ordinary month · v2" });
  await page.getByRole("button", { name: "Change comparison", exact: true }).click();
  await expect(page.getByRole("button", { name: /Ordinary month v2/ })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("link", { name: "Month", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "/tmp/accanto-prototype-mobile.png", fullPage: true });
  await page.getByRole("link", { name: "Goals", exact: true }).click();
  await page.getByRole("button", { name: /Emergency fund/ }).click();
  await page.getByRole("button", { name: "Make inactive", exact: true }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Add entry", exact: true }).click();
  await page.getByRole("combobox", { name: "Type", exact: true }).selectOption("saving");
  await expect(
    page.getByRole("combobox", { name: "Saving goal", exact: true }).locator("option"),
  ).toHaveCount(2);
});

test("keyboard actions, draft protection, browser navigation, and backup restore", async ({
  page,
}) => {
  await page.goto("/#/?view=plans");
  await page.getByRole("button", { name: "Create your first Plan" }).click();
  await page.getByLabel("Plan name", { exact: true }).fill("Draft to keep");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "Goals", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New Plan", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("link", { name: "Goals", exact: true }).click();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Plans", exact: true })).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.getByRole("textbox", { name: "Search actions" }).fill("activity");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
  await page.keyboard.press("n");
  await expect(page.getByRole("dialog", { name: "Add entry", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Settings & data", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export data", exact: true }).click();
  const file = await downloaded;
  await file.saveAs("/tmp/accanto-prototype-backup-test.json");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset prototype", exact: true }).click();
  await page.getByRole("button", { name: "Settings & data", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByLabel("Restore backup file", { exact: true })
    .setInputFiles("/tmp/accanto-prototype-backup-test.json");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Plans", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Draft to keep", exact: true })).toBeVisible();
});

test("parallel investments and giving, repeat entry, and review checkpoints", async ({ page }) => {
  await page.goto("/#/?view=plans&month=2026-10");
  await page.getByRole("button", { name: "Create your first Plan" }).click();
  await page.getByLabel("Plan name", { exact: true }).fill("Household plan");
  await page.getByRole("button", { name: "Add Income source", exact: true }).click();
  await page.getByLabel("Income source 1 name").fill("Salary");
  await page.getByLabel("Monthly net income", { exact: true }).fill("5000");
  await page.getByRole("button", { name: "Save version 1", exact: true }).first().click();
  await page.getByRole("link", { name: "Investments", exact: true }).click();
  await page.getByRole("button", { name: "New investment", exact: true }).click();
  await page
    .getByLabel("Investment name", { exact: true })
    .fill("Long-term retirement brokerage account for our household");
  await page.getByLabel("Contribution target", { exact: true }).fill("10000");
  await page.getByRole("button", { name: "Save investment", exact: true }).click();
  await page.getByRole("button", { name: /Long-term retirement/ }).click();
  await page.getByRole("button", { name: "Add contribution", exact: true }).click();
  await expect(page.getByLabel("Investment", { exact: true })).not.toHaveValue("");
  await page.getByLabel("Amount", { exact: true }).fill("250");
  await page.getByLabel("Keep open to add another").check();
  await page.keyboard.press("Control+Enter");
  await expect(page.getByLabel("Amount", { exact: true })).toBeFocused();
  await page.getByLabel("Amount", { exact: true }).fill("150");
  await page.getByLabel("Keep open to add another").uncheck();
  await page.getByRole("button", { name: "Record entry", exact: true }).click();
  await expect(page.getByText("$400", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Record balance", exact: true }).click();
  await page
    .getByLabel("Investment", { exact: true })
    .selectOption({ label: "Long-term retirement brokerage account for our household" });
  await page.getByLabel("Balance", { exact: true }).fill("12000");
  await page.getByRole("button", { name: "Save balance", exact: true }).click();
  await expect(page.getByText("$400", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Giving", exact: true }).click();
  await page.getByRole("button", { name: "New recipient", exact: true }).click();
  await page
    .getByLabel("Recipient name", { exact: true })
    .fill("Community food bank and neighborhood support fund");
  await page.getByRole("button", { name: "Save recipient", exact: true }).click();
  await page.getByRole("button", { name: /Community food bank/ }).click();
  await page.getByRole("button", { name: "Record donation", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("75");
  await page.getByRole("button", { name: "Record entry", exact: true }).click();
  await expect(page.getByText("$75", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Month", exact: true }).click();
  await page.getByRole("button", { name: "Start monthly Review", exact: true }).click();
  await page.getByLabel("Saved Plan version").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Start Review", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Inspect Investing actual", exact: true }),
  ).toHaveText("$400");
  await expect(page.getByRole("button", { name: "Inspect Giving actual", exact: true })).toHaveText(
    "$75",
  );
  await page.getByRole("button", { name: "Wrap up Review", exact: true }).click();
  await page.getByLabel(/What will you carry forward/).fill("Keep contributions consistent.");
  await page.getByRole("button", { name: "Mark reviewed for now", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reviewed for now", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Reviewed for now", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add entry N", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Type", exact: true })).toHaveValue("giving");
  await page.getByLabel("Amount", { exact: true }).fill("25");
  await page.getByRole("button", { name: "Record entry", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Changes since your last review", exact: true }),
  ).toBeVisible();
  // Crowded data belongs only to this isolated test browser.
  await page.evaluate(() => {
    const key = "accanto-workspace-prototype-v1";
    const state = JSON.parse(localStorage.getItem(key) ?? "{}");
    for (let index = 0; index < 6; index++) {
      state.investments.push({
        id: `investment-${index}`,
        name: `A household investment with a deliberately long name ${index + 1}`,
        target: index % 2 ? null : 5000000,
        active: true,
      });
      state.recipients.push({
        id: `recipient-${index}`,
        name: `Community charitable giving recipient with a long name ${index + 1}`,
        target: index % 2 ? null : 100000,
        active: true,
      });
    }
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const label of ["Month", "Goals", "Investments", "Giving"]) {
    await page.getByRole("link", { name: label, exact: true }).click();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.screenshot({ path: "/tmp/accanto-giving-mobile.png", fullPage: false });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("link", { name: "Investments", exact: true }).click();
  await page.screenshot({ path: "/tmp/accanto-investments-desktop.png", fullPage: true });
});

test("account opening, same-day funding, linked refund and saved estimates", async ({ page }) => {
  await page.goto("/#/?view=goals&month=2026-10");
  await page.getByText("Open a savings account", { exact: true }).click();
  await page.getByLabel("Account name", { exact: true }).fill("Savings");
  await page.getByLabel("Opening date", { exact: true }).fill("2026-10-01");
  await page.getByLabel("Opening amount", { exact: true }).fill("800");
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  await page.getByRole("button", { name: "Add entry N", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("1000");
  await page.getByLabel("Date", { exact: true }).fill("2026-10-16");
  await page.getByRole("combobox", { name: "Funding origin", exact: true }).selectOption("savings");
  await page.getByRole("combobox", { name: /From saving goal/ }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Record entry", exact: true }).click();
  await expect(page.getByText(/short \$200/)).toBeVisible();
  await page.getByLabel("Amount", { exact: true }).fill("800");
  await page.getByLabel("Note", { exact: false }).fill("Laptop purchase");
  await page.getByRole("button", { name: "Record entry", exact: true }).click();
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await page.getByRole("button", { name: "Laptop purchase", exact: true }).click();
  await page.getByRole("button", { name: /Record refund/ }).click();
  await page.getByLabel("Amount", { exact: true }).fill("-200");
  await page.getByLabel("Date", { exact: true }).fill("2026-11-01");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.reload();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("accanto-workspace-prototype-v1") ?? "{}"),
  );
  expect(saved.entries).toHaveLength(2);
  expect(saved.entries[1].refundOf).toBe(saved.entries[0].id);
  expect(saved.audit.length).toBeGreaterThan(0);
  await page.getByRole("link", { name: "Plans", exact: true }).click();
  await page.getByRole("button", { name: "Income estimates", exact: true }).click();
  await page.getByRole("button", { name: "Add estimated income", exact: true }).click();
  await page.getByLabel("Income name", { exact: true }).fill("Salary");
  await page.getByLabel("Gross per payment", { exact: true }).fill("6000");
  await page.getByLabel("Withholding per payment", { exact: true }).fill("1200");
  await page.getByLabel("Payroll deductions per payment", { exact: true }).fill("300");
  await page.getByRole("button", { name: "Save estimate", exact: true }).click();
  await expect(page.getByText("Combined monthly net estimate: $4,500")).toBeVisible();
  await page.getByRole("button", { name: "Duplicate estimate", exact: true }).click();
  await page.getByRole("button", { name: "Save estimate", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("accanto-workspace-prototype-v1") ?? "{}").estimates.length,
    ),
  ).toBe(2);
});

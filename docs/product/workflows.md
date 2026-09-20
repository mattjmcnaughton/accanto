# Accanto: initial Conscious Spending Plan workflows

Historical design input: this specification predates the Python backend.
See [brief.md](brief.md) for the current rich-life, FIRE, companion, and storage
decisions. Browser-only persistence below remains a proposal.

Status: proposed product behavior, ready for review. The application currently
contains only the scaffold; the accompanying interactive concept demonstrates
these flows with example data.

## Design direction

Use the Guided direction: deep teal, pale neutral surfaces, restrained serif
headings, plain sans-serif labels, and generous spacing. Creation presents one
decision at a time. Review uses a compact, readable allocation list with direct
editing. The same labels and calculation rules carry across both surfaces.

The product helps someone decide how to allocate a typical month's income. It
does not track transactions or assess their financial health. No scores, streaks,
or judgmental red/green category targets.

## Initial scope and shared rules

- One personal plan, one currency (USD), monthly amounts. The plan represents a
  recurring month; it is not a separate historical record for each calendar month.
- No account required. The intended app saves drafts and plans in this browser.
  Explain this at entry and after saving, with a downloadable JSON backup.
- Monthly take-home pay is the amount available after taxes and payroll
  deductions. List only allocations funded from that take-home pay. Explicitly
  explain that retirement contributions already deducted from payroll must not
  be entered again. Tracking those contributions is a future extension.
- Four categories: fixed costs, investments, savings, and guilt-free spending.
  Investments and savings remain separate. Categorize debt minimums as fixed
  costs; use helper examples without prescribing a financial strategy.
- Each category supports named line items and monthly dollar amounts. Include a
  total-only entry path so someone can work from estimates without itemizing.
  Total-only and itemized modes are alternatives, never summed together.
- Store and calculate in integer cents; accept nonnegative finite values with
  at most two decimals. Empty is not zero until the user explicitly chooses zero.
  Category totals divided by take-home income determine displayed percentages.
  Dollar amounts are authoritative; displayed percentages may round.
- Remaining = take-home income minus all four categories. A positive remainder
  may be saved as unallocated; show it plainly. A negative remainder can remain
  in a draft, but blocks initial completion and saving changes to an active plan.
- Zero income is valid for drafting. Show percentages as unavailable, never
  divide by zero. Zero income with positive allocations is an overallocated draft.
- Do not silently rebalance categories when income or another category changes.
  Offer an explicit “Use remaining amount” action for guilt-free spending.

## WF-CSP-001 — Create a first plan

**Actor and trigger:** A person opens the app with no saved plan, or resumes an
unfinished draft. They want a usable monthly allocation without facing a large
spreadsheet at once.

**Success:** A named plan is saved, its allocations and any unallocated amount
are visible, and the person lands on the review screen.

| Stage | User action | Product response |
| --- | --- | --- |
| Entry | Select “Create my plan,” or “Resume draft” if one exists | Explain monthly planning and browser-only saving. Start blank, with clearly marked examples as hints, not entered data. |
| 1. Income | Name the plan and enter typical monthly take-home pay | Explain the income basis; show the amount available to allocate. Accept a deliberate estimate. |
| 2. Fixed costs | Enter a total or add housing, utilities, groceries, insurance, minimum debt payments, and other items | Show category total and share of income. Allow add/remove and clear monthly units. |
| 3. Investments | Enter a total or named contributions paid from take-home income | Explain the payroll exclusion; allow an explicit $0. Update remaining amount. |
| 4. Savings | Enter a total or named funds such as an emergency fund or travel | Keep savings distinct from investments. Allow an explicit $0. |
| 5. Guilt-free spending | Enter the desired amount or choose “Use remaining amount” | Show the resulting allocation and remaining amount. Do not automatically claim all remaining income. |
| 6. Check your plan | Read the four totals, percentages, and unallocated amount; select “Edit” beside a category if needed | Return to that wizard step with values preserved. Show any excess and links to affected inputs. |
| Finish | Select “Save my plan” | Persist successfully before showing confirmation. Land on WF-CSP-002 and offer “Download backup.” |

Navigation: Back always preserves entered values. Continue validates the current
step. Completed steps are directly reachable. Save draft and exit is available
throughout. Returning resumes the last step. Draft autosave preserves partially
entered strings as well as valid numeric values; announce “Draft saved” only
after a successful write.

Overallocated drafts: let users continue through the wizard to understand the
whole picture. On the final check, show “Your plan is $X over your income” and
offer edits; disable completion until corrected. Unallocated funds are neutral:
“$X remains unallocated,” with the choice to allocate them or finish as-is.

Storage failure: retain the working draft in memory, show that browser saving
failed, and offer retry or download. Never display a saved confirmation on failure.

### Acceptance scenarios

1. Enter $6,000 income, $3,300 fixed costs, $900 investments, $600 savings, and
   $1,200 guilt-free spending. Review shows 55%, 15%, 10%, 20%, and $0 remaining;
   completing opens the same plan in review.
2. Go back from savings to income, change the income, and return. All category
   inputs remain unchanged; percentages and remaining dollars update.
3. Exit at investments and reopen. Resume the draft with the step and inputs intact.
4. Enter $1,400 guilt-free spending in the example. The check screen identifies
   a $200 excess and blocks completion; correcting to $1,200 permits it.
5. Enter $1,000 guilt-free spending. Save successfully with $200 unallocated.
6. Invalid input gets a field-level explanation; optional zero allocations are
   explicit; zero income never produces an invalid percentage.

## WF-CSP-002 — Review and adjust a saved plan

**Actor and trigger:** A person returns to a saved plan, completes creation, or
opens it after an income or priority change.

**Success:** They understand the current allocation and either retain it or
deliberately save a revision with its impact clear.

| Stage | User action | Product response |
| --- | --- | --- |
| Open | View the saved plan | Show its name, monthly income, four allocation totals and percentages, unallocated amount, and last saved time. Label these planned amounts, not actual spending. |
| Inspect | Expand a category | Show named line items without leaving the overview. No need to repeat the wizard. |
| Tweak | Select “Edit” beside income or a category | Open a focused inline editor or side panel with the existing values and a working copy. The saved plan remains unchanged. |
| Compare | Change an amount, add/remove an item, or change income | Update the draft summary immediately. Show old → proposed amounts, remaining income, and any excess. Keep other category amounts unchanged. |
| Resolve | Adjust another category or undo a change | Preserve the other draft edits. An overallocated revision remains editable but cannot replace the saved plan. |
| Save | Select “Save changes” | Write the revised plan atomically, refresh the overview and saved time, then confirm. Enable a backup download for the revised plan. |
| Cancel | Select “Discard changes,” or leave while edits exist | Explicitly discard the working copy or choose to keep editing. Restore the saved plan exactly. |

Draft revision recovery: autosave the working copy separately from the active
plan. Returning with an unfinished revision offers “Resume changes” or “Discard
changes”; it never silently makes the working copy the saved plan. A save failure
retains both the prior saved plan and the recoverable working copy.

Download backup exports the saved plan. If edits are pending, clearly offer
either the saved plan or the draft instead of silently choosing. An initial
backup format contains its version, currency, income, categories, item names,
amounts, and saved timestamp. Backup restoration can be scoped separately.

### Acceptance scenarios

1. A returning user sees the saved $6,000 plan immediately, without onboarding.
2. Increase savings from $600 to $800. The preview shows the $200 increase and
   $200 excess; reduce guilt-free spending from $1,200 to $1,000, then save.
   The new plan balances and reopening shows both changes.
3. Change income to $6,500. Category dollars remain unchanged; $500 is
   unallocated and percentages reflect the new denominator.
4. Edit fixed costs and discard. The previous saved values and timestamp remain.
5. Navigate away during edits. The user can keep editing or discard; reopening
   an autosaved revision requires an explicit resume decision.
6. Simulate a storage failure on save. Show a retry/download route, retain the
   prior plan, and never claim the revision was saved.

## Concept coverage

The interactive concept covers the six wizard steps, back navigation, live
totals, remaining-allocation action, overallocated completion blocking, transition
into review, direct editing, before/after totals, save, and discard. It uses
clearly labeled example data and memory-only state. Itemization, persistence,
backup downloads, draft recovery, and failure states are specified above rather
than implemented in the concept.

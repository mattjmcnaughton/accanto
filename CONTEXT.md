# Accanto domain context

Accanto helps an Entity plan its money, compare results with a saved
plan, and make deliberate choices about spending, giving, saving, and investing. Use these terms
consistently in product discussions, UI copy, code, and tests. Refine them as
decisions are made. The frontend is an interactive design prototype. Production
application, backend, and database design follow workflow approval.

The [product brief](docs/product/brief.md) records the current direction.
The [MVP PRD](docs/prd/01-mvp.md) defines the proposed MVP requirements and
acceptance criteria; this file defines their shared domain meanings.

## Ubiquitous language

| Term | Meaning |
| --- | --- |
| User | The account identity used for sign-in and account management. A User owns one or more Entities and works in one at a time. A User is not itself the financial planning boundary. |
| Entity | A User’s named financial workspace and the planning boundary for Income sources, Plans, Reviews, saving goals, savings accounts, investments, debt accounts, giving recipients, cash-account tags, and recorded activity. Its finances are viewed and totaled together. Income sources belong to individual Plans within the Entity, not to a shared Entity source catalog. |
| Entity time zone | The time zone used for defaults such as today and this month across browser, API, and MCP. Financial activity belongs to the calendar date selected for it, not the date of entry or a time-zone conversion. Changing the time zone does not move existing activity between dates or Periods. |
| Currency | All monetary amounts use U.S. dollars (USD): Plan inputs and results, actual entries and adjustments, funding origins, saving goals, contribution targets, investment balance observations, and projections. Mixed-currency records and currency conversion are outside current scope. |
| Income source | A Plan's named, stable identity for a source of money, scoped to that Plan's Entity. Identity persists across edits and saved versions of that Plan; changing salary amounts requires no relinking. Copying a Plan creates new Income source identities. Each monthly Plan specifies a directly entered planned net amount for each included source. Salary, withholding, and payroll assumptions belong to a separate optional estimation workflow. A generic label such as “Primary salary” can distinguish a source without a separate Individual record. An Income source and its planned amounts are distinct from money actually received. Existing Plan copy may shorten Income source to Income. |
| Income frequency | How often an income occurs: annually, monthly, twice a month (24 payments per year), weekly, or daily. |
| Plan cadence | The interval a Plan uses for its allocation inputs: monthly in current scope. Income frequency belongs to the optional estimator; fixed-cost frequency remains a separate Plan input. Annual Plans are future work. Saved versions preserve the cadence used when saved. |
| Period | One calendar month for actual activity and Reviews. Plans and Reviews are monthly in current scope. Annual salary inputs belong to the estimator; annual expense inputs remain supported; annual Plans and annual rollups are deferred. |
| Planned gross income | An input to the separate income-estimation workflow, before expected withholding and payroll deductions. It is not a monthly Plan funding input. |
| Plan | An Entity's named intention for income, fixed costs, giving, guilt-free spending, saving, and investing for a month. It accepts multiple named sources of monthly net income directly. Its editable draft can be saved as a new Plan version. It shows the calculated tithe as a giving target, sets guilt-free spending, and allocates monthly amounts to individual saving goals, investment destinations, and giving recipients. Destination allocations roll up into their category totals. Saving allocations target goals or a named savings account’s Unallocated savings. |
| Plan version | An immutable saved snapshot of a Plan's intention, including its cadence, assumptions, and calculation results. Older prototype versions may also contain tax-estimate fields, which remain preserved. A Review targets one version for comparison. |
| Tax year | Deferred beyond v1. The year whose tax rules and standard deduction apply to a Plan's Entity tax estimate. It is saved with each Plan version. |
| Filing status | Deferred beyond v1. The tax-return status selected in a Plan for its Entity tax estimate. It determines which tax rules and standard deduction apply; it is not inferred from Income labels. |
| Saved income estimate | An Entity's named, saved scenario containing multiple income lines and their estimation assumptions, kept independently of Plans and actual Income sources. An Entity can save multiple estimates and reopen them to calculate monthly net income. Copying a result into a Plan is manual and establishes no relationship or synchronization. |
| Monthly net-income estimate | The output of a separate optional page/workflow that estimates monthly net income from salary, expected withholding, payroll deductions, and payment frequency. It can inform a Plan but is not actual income or a live link that rewrites Plans. |
| Take-home override | A legacy prototype field preserved in historical saved versions. New monthly Plans directly accept net income per source and do not need a total override. |
| Planned net income / planned take-home income | The sum of directly entered monthly net amounts across a Plan’s named Income sources. Used for income allocations and the tithe target; distinct from actual receipts and planned use of savings. |
| Actual net income | The net amount actually received from one Income source during a Review's Period, after taxes and payroll deductions. Dated receipts and adjustments roll up by source. It remains separate from planned gross Income. |
| Income total | An Entity sum across Income sources. An actual net total is complete only when every included source has a recorded amount, including an explicit zero entry; an unknown source is not treated as zero. |
| Tax withholding | Income tax taken from an Income payment before the money is received. It affects net deposits but is not the same as final tax owed. |
| Payroll deduction | An amount taken from an Income payment for a purpose such as benefits or retirement contributions. It affects the net deposit and is distinct from an itemized tax deduction. |
| Expected itemized deduction | Deferred beyond v1. The estimated deductible amount entered for one tax-return category, such as eligible charitable contributions, mortgage interest, or state and local taxes (SALT). Category amounts have a calculated total; they are not the full associated expense, an additional cash outflow, or a payroll deduction. |
| Standard deduction | Deferred beyond v1. The deduction amount applicable to the tax year and filing assumption, shown alongside the expected itemized total. |
| Deduction used | Deferred beyond v1. The larger eligible amount of the standard deduction and expected itemized total, selected automatically for the Entity tax estimate. Both amounts remain visible. |
| Entity tax estimate | Deferred beyond v1. One approximate annual income-tax calculation for the Entity, based on its combined annual Income, selected filing status, tax year, and deduction used. It is not the sum of taxes calculated independently for each Income source. |
| Under-withholding flag | Deferred beyond v1. A notice when estimated annual income tax exceeds expected annual withholding. It does not create a tax reserve, reduce unassigned cash, or change planned tithe. |
| Fixed costs | Entity-wide planned recurring expenses, with a separate amount and monthly or annual frequency for each cost. |
| Tithe | A giving target calculated as 10% of planned take-home income, shown alongside monthly giving allocations to named recipients. Recipient allocations may be above or below it; show their difference without blocking a Plan save. Cash allocation uses the recipient allocation total, not this target. It is distinct from cumulative recipient targets and actual donations. |
| Guilt-free spending | Entity-wide planned discretionary spending. This includes money allocated from the shared account to personal accounts for individual spending, informally called “dividends.” Such allocations are ordinary guilt-free spending entries, not a separate category, domain type, or workflow. Here “dividend” does not mean an investment distribution. |
| Saving goal | An Entity's named purpose for cash set aside in one linked savings account. A finite goal has a positive funding target and may be explicitly completed and archived; an ongoing goal can be funded and used indefinitely, with an optional positive target to keep on hand. Goals are managed independently of Plans. Archived or inactive goals preserve history and are unavailable for new contributions. Home repair and an emergency fund can be ongoing goals. Each account also has a mandatory ongoing Unallocated goal with no target and a protected lifecycle. |
| Savings account | An Entity's named location for saved cash, with a dated opening amount. Each account holds saving goals, including exactly one mandatory Unallocated goal; each goal belongs to exactly one account. It can fund recorded outflows. It is distinct from a saving goal (a purpose for money) and from the prototype's descriptive cash-account tags. Bank integration and reconciliation are not implied. |
| Opening amount | The money already held in a savings or investment account, or owed on a debt account, at the start of the calendar date tracking begins. Same-day activity occurs after this opening position. It establishes a starting position, not income, spending, a new contribution, or an amount allocated from the current month's Plan. For an investment account, it is a starting balance observation, not a claim about historical contributions or returns. |
| Unallocated savings | Money assigned to the mandatory Unallocated saving goal in each savings account, pending a more specific purpose. Every saved dollar belongs to a goal. Each account has exactly one Unallocated goal, with no target; it cannot be inactivated, completed, archived, or deleted independently. Plans, contributions, savings funding, transfers, and reconciliation reference its stable goal identity like other savings goals. It is part of the account, not an additional asset, another account, new income, or the Unassigned Plan amount. |
| Cash-account tag | A prototype-only descriptive label on a saving goal naming the account where its cash is held. The agreed account model replaces this optional label with a link to exactly one Savings account. Contributions to the goal inherit this tag. A tag alone is not a tracked account balance or a record of savings used. The agreed Funding origin workflow below adds explicit savings-use records; account opening amounts are supported domain direction, while automated bank reconciliation remains out of scope; simple savings-account transfers are supported. |
| Investment | A named Entity investment destination, with active/inactive status and an optional cumulative contribution target. Contributions and dated balance observations are separate; the target measures contributed money, not market value. |
| Debt account | An Entity's named liability, such as a car loan, with a dated opening amount owed and subsequent dated observations of the amount owed. It is a peer of savings and investment accounts, not a saving goal or investment destination. Payments and observed amounts owed are separate. |
| Debt payment | A dated outflow associated with a Debt account and funded from income or savings. Record the outflow once. It does not automatically reduce the observed amount owed: the payment may include interest or fees. |
| Debt balance observation | The amount owed on a named Debt account as of a particular date. Recording or correcting it does not create a payment, income, or spending. The latest observation is a dated reported amount, not an automatically calculated live balance. |
| Giving recipient | A named charity or recipient with active/inactive status, donation history, and an optional cumulative contribution target. Refunds reduce net donations. Recording giving does not establish tax deductibility. |
| Review checkpoint | A personal annotation marking a month reviewed or closed, set or cleared whenever the person chooses. It requires no completeness check or acknowledgment step and does not lock activity, finalize accounting, or turn unknown actuals into zero. Later changes may be indicated for information without clearing the annotation or preventing edits. “Closed” and “reviewed” describe the same annotation, not separate enforcement states. |
| Contribution | Money added to a saving goal, a named account’s Unallocated savings, or an investment, or given to a giving recipient as a donation. Contributions are dated actual entries, recorded separately from destination setup. Their Funding origin distinguishes newly allocated income from previously saved money. A saving-goal contribution inherits the goal’s cash-account tag. Ordinary saving and investment contributions are nonnegative; giving permits negative entries for refunds. |
| Donation | An actual giving payment to a named Giving recipient, or Unassigned giving. A refund is a negative giving entry. Net donations are donations less refunds; they do not establish tax deductibility. |
| Saving target | The positive amount of remaining saved money intended for a goal. It is required for a finite goal and optional for an ongoing goal. It measures funding available for the purpose, not lifetime contributions or a monthly Plan allocation. A blank optional target means no funding threshold, not a zero target. |
| Funded | A saving goal's remaining saved meets or exceeds its Saving target. Designated opening savings and reassignments count toward funding. Funded does not mean completed or archived; using savings can put an active goal below its target again. |
| Completed / archived goal | A finite saving goal explicitly marked finished and removed from active goal lists. Completion returns any positive remaining saved to the same account’s Unallocated savings and archives the goal together. Preserve its history, account association, and saved Plan comparisons; block new contributions while archived. Completion is a person’s decision, not an automatic consequence of reaching a target. |
| Contribution target | An optional positive cumulative amount intended for an investment destination or giving recipient. It measures recorded contributions (net of giving refunds), not a savings funding threshold or investment market value. It does not reset monthly or change Plan allocations. A blank target means no cumulative contribution target, not zero. |
| Recorded progress | For investments and giving, recorded contributions including assigned adjustments, net of giving refunds. Investment progress measures contributions, not observed market value. For saving goals, show remaining saved against the Saving target when present, with contribution history separately; previously saved money can fund a goal without inventing contributions. |
| Active / inactive | A destination’s availability for new contributions. Inactivation preserves its recorded history and allows corrections to existing entries; reactivation permits new contributions again. Reaching a target does not automatically make a destination inactive. An investment need not be inactivated merely because it receives no regular contributions. |
| Transfer | A move of existing money between locations. Moving already-saved money between bank accounts creates neither income nor spending nor new saving. A savings transfer records equal movements between two different savings accounts in the same Entity, identifying a goal or Unallocated savings at each end. Investing previously saved money is recorded as an investment contribution with a savings Funding origin, rather than as new saving from income. |
| Balance reconciliation adjustment | A signed, dated correction to the remaining saved in one selected saving goal or an account’s Unallocated savings, applied when that amount is reconciled. It never targets the physical account total directly. Preserves the original opening amount and earlier balances. It is not income, spending, a new saving contribution, or savings used, and is distinct from a monthly category adjustment. |
| Balance observation | An amount observed for an investment on a particular date. It may be associated with a named Investment or remain unassigned. It does not create a contribution, count toward contribution targets, or enter Review actuals. The latest observation is dated, not a live account balance. Savings accounts have an explicit Opening amount; manual reconciliation of individual goals or Unallocated savings is supported; automated bank reconciliation and ongoing cash balance observations remain deferred. |
| Funding origin | Where the money funding an outflow comes from: current income or previously saved money in a named savings account, with a saving goal always identified, including its Unallocated goal. Each outflow has exactly one funding origin in current scope; split funding is deferred. It is separate from the outflow's category and destination. Income as an origin means the current-income pool, not another income receipt or a requirement to match a specific paycheck. |
| Planned use of savings | A monthly Plan funding line identifying a savings account and the amount intended for use from it. A Plan may contain multiple such lines. It increases planned funding without increasing planned or actual income, moving money, or recording an outflow. |
| Percentage base | The explicitly named denominator for a particular metric, using either planned amounts or actual amounts. Net income, total funding, and income plus selected savings funding are distinct candidate bases; there is no universal or settled default. |
| Fixed-cost percentage | An explicitly labeled fixed-cost numerator divided by its stated percentage base, multiplied by 100. Its purpose, numerator, and denominator must be visible; the metric choices below remain open. |
| New saving from income | Money newly set aside from current income during the period, net of applicable corrections. Moving or reassigning existing savings is not new saving. |
| Net saving | New saving from income less savings used during the same period. It can be negative and is distinct from account balance changes, transfers, and investment contributions. |
| Total planned funding | Planned net income plus planned use of savings. This is the amount available for allocation within the Plan, not an observed balance or evidence that expected income has arrived. |
| Savings used | Previously saved money applied to a recorded expense, donation, or investment contribution. It is linked to that outflow and reduces the recorded savings remaining at its origin. It is not new income, a second expense, or an adjustment correcting an error. |
| Remaining saved | A savings account’s opening amount plus subsequently recorded money set aside less recorded uses, including net transfers, dated balance reconciliation adjustments, and applicable corrections. For a goal, remaining saved includes designated opening savings, subsequent contributions, net transfers, and net reassignments, less uses and applicable corrections; distinguish this from cumulative contribution progress. It is derived from recorded activity, not a verified bank-account balance. |
| Actual entry | A dated receipt, payment, contribution, or adjustment recorded for an Entity and assigned to its Income source, spending category, saving goal or account’s Unallocated savings, investment, or giving recipient as applicable. An outflow also has a Funding origin. It is distinct from a Plan amount, account-to-account Transfer, and Balance observation. |
| Unassigned activity | An entry without a named source or destination, including unplanned income or expenses and category adjustments. It remains included in monthly category totals and can be assigned explicitly later. It is unrelated to unassigned money in a Plan. Saving entries, including positive, negative, and zero adjustments, always identify a saving goal; they cannot be Unassigned. |
| Unassigned Plan amount | Total planned funding less planned fixed costs, allocated giving, guilt-free spending, saving, and investing. A positive amount has not been allocated; a negative amount indicates overallocation. Overallocation is visibly flagged but does not prevent saving a Plan version. It is a planning calculation, not an observed cash balance or available-to-spend amount. |
| Recorded net cash flow | Review actual net income less the five outflow category actuals, including adjustment entries. It remains unknown when a required category total is unknown or incomplete. It is not an account balance. |
| Unknown actual | An item with no recorded entries. Unknown is distinct from an explicit zero. A known recorded amount can still represent only part of a month’s activity. |
| Rollup | A sum calculated from underlying actual entries. The contributing entries remain visible. |
| Adjustment entry | A labeled, dated actual entry for the difference between a known total and the currently recorded total. It may be positive, negative, or zero; it changes the rollup without changing existing entries. It can be edited or deleted. Later entries add to the total rather than being masked. Every saving-category adjustment must explicitly identify a saving goal, including an account’s Unallocated goal; it affects both saving actuals and that goal’s remaining saved. It is distinct from balance reconciliation. |
| Review income match | An explicit association belonging to one Review that compares receipts assigned to an Income source in another Plan with a source in the selected saved Plan version. It changes comparison grouping, not receipt assignments, dates, amounts, or other Reviews. Names never establish a match automatically. |
| Review | An Entity's editable record of what actually happened in one Period: net income per Income source, spending, giving, contributions, and notes. Its actuals are always rollups of dated entries, including adjustments. It targets one saved Plan version and covers one calendar month. The target may be changed explicitly. A Plan version may be targeted by many Reviews. |
| Projection | An illustrative future result calculated from explicit assumptions, distinct from recorded balances and activity. |
| FIRE target | Estimated assets needed to support selected spending at the chosen withdrawal rate. |
| Transaction source | An outside system connected to an Entity that supplies transactions, such as a YNAB plan. Accanto reads from it; it is not an authority over Accanto's records. |
| Staged transaction | One transaction (or one split line) from a Transaction source, waiting in the Transactions inbox. It is not an actual entry and never contributes to totals. Its status is waiting, skipped, recorded, or conflict. |
| Transactions inbox | The Entity's list of staged transactions. Each is recorded as an actual entry or skipped by an explicit action. |
| Proposal | A partial completion of a staged transaction (category, assignment, funding origin, refund link, or skip) with a rationale and its proposer. It is not an actual entry and is never applied without an explicit record. |
| Agent | A caller acting for the owner through the agent tool catalog: the built-in agent or an MCP client. Not a permission role; it has the owner's Entity access, narrowed by the catalog and Agent mode. |
| Agent mode | Per Entity: `propose` (default) or `record`. Decides whether agent writes run or become Pending changes. Setting inbox Proposals and syncing are allowed in both modes. |
| Pending change | A validated, not-yet-applied write drafted by an Agent. Not financial activity; never in totals. The owner applies or dismisses it in Accanto. Deletes that cannot be restored are always Pending changes. |
| AGENT.md | The owner's standing instructions for the built-in agent, per Entity. Trusted instructions, below enforced rules: it cannot widen the catalog, Agent mode, or the Entity boundary. |
| Untrusted data | Any text read from the Entity, a source, or an image (payees, memos, notes, names, rationales). Quoted to the model as data, never followed as instructions; an instruction found there is reported to the owner. |

## Actors and roles

In current scope, the person using Accanto can create and edit Plans, record
activity, and review results. Planning, recording, and reviewing are activities
of the same actor, not separate Planner, Recorder, or Reviewer permission roles.
User remains the account identity; Entity remains the financial planning boundary.
There is no separate approver or required approval handoff. Shared access and
any future division of responsibilities require explicit later decisions.
An Agent acts for that same person within one Entity at a time; it is not a
separate actor with its own permissions ([PRD 02](docs/prd/02-agent-access.md)).

## Commands, events, and policies

These names describe domain actions and outcomes. They do not prescribe event
sourcing, a message broker, or asynchronous processing.

### Save a Plan version

- **Actor:** the person using Accanto.
- **Command:** Save Plan version from the Plan's editable draft.
- **Event:** Plan version saved, after the snapshot is successfully saved.
- **Policy:** capture the draft's inputs, assumptions, and calculation results
  together as an immutable version. Preserve earlier versions unchanged.
- **Policy:** existing Reviews keep their explicitly linked version. Saving a
  new version never automatically retargets them or changes their comparisons.
- **Policy:** allow saving a Plan version even when total allocations exceed
  total planned funding. Clearly show the amount overallocated; do not reduce
  allocations, invent income, or assume savings will fund the gap. A warning
  informs the person without requiring the Plan to balance before saving.
- **Consistency rule:** save the complete snapshot or report failure; do not
  expose a version with only some of its inputs or results recorded.

Example: saving a version with $600 of planned guilt-free spending leaves an
October Review linked to an earlier $500 version comparing against $500. Changing
that comparison requires an explicit change to the Review's linked version.

### Start a monthly Review

- **Actor:** the person using Accanto.
- **Command:** Start monthly Review, choosing the month and a saved Plan version.
- **Event:** Monthly Review started.
- **Policy:** when the immediately previous calendar month has a Review,
  preselect its linked Plan version and show that choice before creation. Allow
  the person to choose a different saved version explicitly. A newer version
  does not automatically replace this default.
- **Policy:** without a previous-month Review, ask the person to select a saved
  version. Never fabricate a previous comparison or select an unrelated Plan
  implicitly. At most one Review exists per Entity per calendar month.
- **Policy:** starting a Review does not copy or create actual activity; roll up
  the Entity's entries already recorded for that month.

Example: October targets version 2. Even if version 3 has since been saved,
starting November preselects version 2, visibly, until the person chooses otherwise.
The prototype preselects this version and requires an explicit save.

### Annotate a month as reviewed or closed

- **Actor:** the person using Accanto.
- **Command:** Mark month reviewed (or closed); the annotation can also be cleared.
- **Event:** Review annotation set or Review annotation cleared.
- **Policy:** allow the annotation whenever the person chooses, including with
  unknown actuals or an incomplete Review. No mandatory acknowledgment or
  completeness validation is required; an optional takeaway may accompany it.
- **Policy:** preserve unknown amounts and keep all activity, notes, and the
  linked Plan comparison editable. Later-change indicators are informational;
  they do not automatically clear the annotation or require reopening the month.
- **Boundary:** persist the annotation for continuity, but introduce no database
  lock, posting restriction, or financial finalization rule based on its value.

### Reassign saved money

- **Actor:** the person using Accanto.
- **Command:** Reassign saved money, specifying the amount and the originating
  and receiving goal or unallocated savings within the same savings account.
- **Event:** Saved money reassigned.
- **Policy:** reduce the originating designation and increase the receiving
  designation by the same amount. The account's total remaining saved is unchanged.
- **Policy:** create no income, spending, or new saving contribution. Preserve
  contribution history and monthly Plan allocations; only the purpose of
  existing saved money changes.
- **Consistency rule:** both sides succeed or fail together. A reassignment
  cannot exceed the amount remaining at its origin. Movement between bank
  accounts uses the separate savings-transfer workflow.

Example: reassigning $500 from unallocated savings to Laptop reduces unallocated savings by $500
and increases Laptop's remaining saved by $500. It does not count as $500 of
new saving in that month's Review or as a new contribution toward the goal.

### Add income to savings before a purchase

Each entry has one funding origin. When a purchase needs existing savings plus
some current income, record the income-funded saving contribution first, then
record the whole purchase from that saving origin. These are two ordinary
recording actions, not a split-funded purchase or a requirement to physically
transfer money between bank accounts.

Example: Laptop has $800 remaining saved. Record a $200 contribution from current
income to Laptop, bringing remaining saved to $1,000. Then record a $1,000 laptop
purchase funded entirely from Laptop savings, leaving $0 remaining.

The month shows $200 of new saving, $1,000 of spending, and $1,000 of savings used.
Do not present the contribution plus purchase as $1,200 spent. The contribution
is allocation to savings, and the purchase uses those saved funds. The funding
breakdown identifies the $200 allocation from current income; savings use does
not create another income receipt. Both entries remain visible in their histories.
After the first action succeeds, the contribution stands even if the purchase
is recorded later or never occurs; there is no long-running process to complete.

### Record a purchase

- **Actor:** the person using Accanto.
- **Command:** Record purchase, with date, amount, spending category, optional
  note, and funding origin; a savings origin must identify a saving goal, including Unallocated.
- **Event:** Purchase recorded, after the complete operation succeeds.
- **Policy:** include the purchase once in its month's spending. If funded from
  savings, include its linked savings use in the origin's recorded uses and
  reduce remaining saved, without creating income or erasing contributions.
- **Policy:** reject an outflow that would make its savings account or selected
  goal/Unallocated savings negative. First record sufficient funding or explicitly
  reassign/transfer existing savings. Never invent funding or silently change origin.
- **Policy:** when relevant activity changes after a Review checkpoint, flag
  that month for another look.
- **Consistency rule:** the purchase and its linked savings use succeed or fail
  together. The person performs one action, with no separate withdrawal
  confirmation and no partially recorded result. This rule does not require a
  long-running process manager.

Example: recording a $1,000 laptop purchase funded from the Laptop goal adds
$1,000 to guilt-free spending and $1,000 to that goal's savings used. Income and
cumulative contributions remain unchanged; remaining saved decreases by $1,000.

If Laptop shows $800, reject a $1,000 purchase until the person records another
$200 contribution, reassignment, or transfer into that goal. The account and its
selected pot must both have sufficient recorded money.

### Record a purchase refund

- **Actor:** the person using Accanto.
- **Command:** Record refund from the original purchase, entering the refund's
  date and amount. Full and partial refunds use the same workflow.
- **Event:** Refund recorded, after the complete operation succeeds.
- **Policy:** preserve the purchase and record the refund as a separate linked
  entry. Reduce spending in the refund's calendar month, not the purchase month
  when those differ. A refund does not create income.
- **Policy:** return the refund to the purchase's original funding origin
  automatically, with no destination choice. For a savings-funded purchase,
  reduce savings used and restore remaining saved at that origin, including the
  original goal where applicable. Do not count restored savings as a new
  contribution. For an income-funded purchase, reduce spending without creating
  a savings contribution or another income receipt.
- **Consistency rule:** recording the refund and restoring its funding succeed
  or fail together. Relevant changes flag the refund month's Review for another
  look; the original purchase remains unchanged.

Example: a $1,000 laptop purchase in October followed by a full refund in November
leaves October's purchase visible and records -$1,000 of spending in November.
The Laptop goal returns to $1,000 contributed, $0 net used, and $1,000 remaining.
A $200 partial refund instead leaves $800 net used and $200 remaining.

The prototype implements linked Record refund with original-origin restoration. Repurposing a refund is outside this initial flow.

## Bounded context and external integrations

Accanto currently has one financial domain context. Plans, actual activity,
funding origins, saving goals, savings and debt accounts, investments, giving, and Reviews share its
ubiquitous language and rules. Account access is an application responsibility;
we are not introducing a separate bounded context for it at this stage. These
responsibilities do not require separate services or databases.

Ingestion from YNAB uses an **anti-corruption layer**: an explicit
translation boundary between YNAB's external concepts and Accanto's domain.
External terminology, categories, transaction semantics, and identifiers must be
mapped deliberately rather than becoming Accanto's domain model by default.
Imported activity must satisfy Accanto's financial rules just as manually
recorded activity does. The mapping and handling of ambiguous or unsupported
records require decisions when ingestion is in scope.

Read-only YNAB import is in scope through the Transactions inbox
([TDD](docs/tdds/02-transactions-inbox.md)). The YNAB adapter maps YNAB payloads to
a provider-neutral staged transaction; nothing becomes an actual entry until a
person (or a caller they allow) records it through the normal entry commands. A
second source would add one adapter module, not an integration framework.

## Domain boundaries

A User is the account boundary. An Entity is the financial boundary. One User
owns each Entity and may own several, such as Family and Personal; there is no
sharing or membership. The User works in one Entity at a time and switches
explicitly. Records never link across Entities: a funding origin, assignment or
transfer names only records of the same Entity, and there are no cross-Entity
transfers. A Transaction source's plan feeds one of the User's Entities at a time.
All Plans, Reviews, Income sources, activity, goals, savings accounts, investments,
debt accounts, giving recipients, and balance observations are scoped to their Entity. Totals never combine different
Entities: figures from several Entities may be shown side by side, each labeled
with its Entity, but never added into a combined total. A household can be represented by an Entity, but Household
is not a separate domain type or the name of the account owner.


Saving goals, Investments, and Giving recipients are parallel Entity concepts.
“Goals” in navigation means cash saving goals; an Investment or Giving recipient
is not a kind of saving goal. “Destination” is shorthand for a contribution target in the shared workflow,
including a saving goal, an account’s Unallocated savings, an Investment, or a
Giving recipient; it is not a separate financial entity.

An Entity may have multiple named Plans. A Plan has multiple saved versions;
each version captures the Plan cadence and assumptions at that point. A Review
targets exactly one saved version and covers one calendar month.
Multiple Reviews may target the same version.

Plans are independent, including copied scenarios. Changing one Plan's net-income amounts, allocations,
or other assumptions never changes
another Plan. Income sources belong to one Plan and retain their identities across
that Plan's edits and saved versions. Copying a Plan creates new Income source
identities; sources are not shared across Plans. Changing a salary amount within
a Plan requires no relinking. When a Review switches to a different Plan, the
person explicitly matches existing receipt sources to the new comparison's
Income sources. These matches belong to that Review; they do not reassign or
copy receipts, affect other months, or change Entity totals. Names alone never
establish a match. Fixed-cost identity behavior is unchanged by this income decision.

- All planning and recorded financial data belongs to an Entity. Income
  sources have labels but no separate Individual owner or person-level subtotal.
  Plan versions preserve the Income inputs used at the time; changing an Income
  does not rewrite earlier versions or recorded receipts.
- Fixed costs and guilt-free spending belong to the Entity.
- A personal spending allocation (informally, a dividend) is recorded once as
  guilt-free spending when shared money is allocated to personal spending.
  Subsequent purchases using that allocation are not counted again in the same
  Entity's spending. Its purpose distinguishes it from simply moving money
  between accounts while keeping it available for shared use. This does not
  require tracking personal accounts, their balances, or their purchases.
- Monthly Plans accept multiple named Income sources with directly entered monthly
  net amounts. Reviews compare each source's actual net receipts with its planned
  net amount from the linked saved version.
- Salary, expected withholding, payroll deductions, and income frequencies belong
  to a separate optional monthly net-income estimation page/workflow. Annual
  salary inputs can inform a monthly estimate without introducing annual Plans.
  Using an estimate in a Plan is an explicit choice; later estimator edits never
  silently change a draft, saved version, or actual receipt. Withholding remains
  an entered assumption, not a calculation of final tax owed.
- The prototype implements this separation. Preserve
  historical gross-income inputs, take-home overrides, and saved results; do not
  silently reinterpret or recompute existing versions.
- Entity tax estimates, tax-year and filing-status selection, standard/itemized
  deduction calculations, and under-withholding flags are deferred beyond v1.
  The prototype no longer presents the illustrative tax panel in the v1 flow;
  existing saved versions retain their stored inputs and results unchanged.
- An Entity is not automatically a tax return or legal person. Future tax
  estimation requires explicit scope and verified calculation rules. Recorded
  giving does not establish tax deductibility. V1 does not infer tax eligibility
  or reserve money automatically for a projected tax shortfall.
- Each source's actual net income is recorded for the Review Period. The Entity
  actual income total is derived by summing entries. Expected sources come only
  from the linked Plan version; other Plans do not introduce missing actuals.
  Additional income and expenses remain included as unplanned actual activity.
  Expected items with no entry are unknown, not zero. Show the recorded subtotal
  as incomplete and withhold the category difference until each expected item has
  an entry or explicit zero. The same rule applies to expected fixed costs.
- A Plan allocates monthly saving amounts to named saving goals or an account’s
  Unallocated savings, and monthly
  investing amounts to named investment destinations. Category totals are sums
  of these lines, not independently entered allocations. Goals describe purposes;
  savings accounts describe where cash is held. An allocation to Unallocated
  savings references that account’s mandatory Unallocated goal.
  Actual contributions link to the same goal or investment identity so Reviews
  compare both destination lines and category totals against the linked version.
  Creating a destination does not automatically allocate money or change a Plan;
  including a planned amount requires an explicit Plan edit. Unplanned actual
  contributions remain visible and included in totals. Saved versions preserve
  their allocation lines even if a destination is later renamed or inactivated.
- Saving goals have active or inactive status and are managed separately from
  recording contributions. Each goal links to exactly one savings account;
  several goals can share that account, including its mandatory Unallocated goal.
  Contributions to a goal identify its linked account. Spending from that goal
  uses the same account as funding origin. New prototype goals use this account
  model; legacy descriptive tags remain preserved without inferred accounts.

  Inactive goals remain visible in history but cannot be selected for new
  contributions.
- Monthly Reviews can be built from individual dated actual entries for Income,
  fixed costs, guilt-free spending, giving, investing, and saving goals. Review
  rollups show the sum of those entries as "recorded so far" while more entries
  may be added. No entries for an item means unknown, not zero. Entering a known
  total creates an adjustment for its difference from recorded entries. For example,
  $210 recorded and a known total of $250 creates a +$40 adjustment. Deleting that
  adjustment restores $210. Entering zero with no entries creates an explicit zero.
  A category adjustment does not resolve unknown individual items. Adjustments
  assigned to destinations also affect their recorded progress; category-only
  adjustments are not attributed to a destination where Unassigned activity is
  permitted. Saving-category adjustments always require an explicit goal, including
  an account’s Unallocated goal, even for zero. No goal-less savings adjustment
  or implicit allocation to Unallocated is allowed. Later receipts add to the total:
  remove or correct an adjustment if those receipts represent the same money.
  Account-to-account transfers and observed balances do not enter a contribution
  rollup. An investment funded from savings does enter the investment destination
  history, with its origin distinguishing it from an allocation of current income.
- The legacy prototype annualizes each Income source using its frequency, then divides
  by 12 to show smoothed monthly comparison amounts. Allocation inputs are monthly. A weekly Income source still uses 52
  occurrences per year. Twice-monthly Income uses 24 payments per year, with
  gross amounts, withholding, and payroll deductions entered per payment. The
  UI calls this “Twice a month,” distinct from every two weeks (26 payments).
  Daily income requires an
  explicit number of paid days per year; it never silently assumes every
  calendar or working day is paid. These are estimation conventions, not actuals. Under the agreed separation,
  frequency conversion belongs to the estimator rather than monthly Plan entry.
- Plans and projections describe intentions and scenarios. Reviews and
  dated balances describe recorded results. A Review targets one saved
  Plan version; editing the Plan draft or saving a later version does not rewrite
  the Review's target or planned comparison amounts. A user may deliberately
  change the target, which changes the planned comparison.
- When a Review is retargeted, entered actuals remain attached to their stable
  Income source or category identities. Switching versions within the same Plan
  retains matching source identities without relinking. Switching to a different
  Plan requires explicit Review income matches to compare existing receipts with
  its sources. Unmatched expected sources remain unknown until matched or
  recorded, including an explicit zero. Unmatched receipts remain visible as
  actual-only activity and count once in Entity totals. Matching never duplicates
  activity. Match cardinality and handling on subsequent retargeting remain
  workflow details to finalize. Names alone do not establish identity.
- Reviews are monthly only. An Entity has at most one Review for each calendar
  month. A Plan version may be targeted by many Reviews. Reviews stay editable
  without a lock step. A user may mark a month reviewed or closed whenever they choose; this is a personal annotation, not a finalization. Editing one month does not change another.
- Current scope is monthly Plans and monthly Reviews. Annual Plans and annual
  rollups are intended future capabilities, with their design deferred. Annual
  Income and fixed-cost frequencies remain supported and are smoothed monthly.
  The prototype now edits monthly Plans, while preserving older saved versions
  and visibly converting legacy annual drafts to monthly inputs when edited.
- Review actuals have no independent override or permanent Manual history flag.
  Adjustments remain visible as entries in Activity and Review detail. Editing or
  deleting one recalculates totals and flags a reviewed month for another look.
  Annual expenses are smoothed in the Plan and recorded as paid in Reviews.
- A goal's Saving target and actual contributions are distinct from its
  monthly allocation in each Plan. Cash-account tags do not track balances or
  earmarks. Do not count a transfer as new saving.
- Cash savings remain distinct from market investments and projected market
  growth, even when the cash is held at an investment institution. Any future
  cash yield or inclusion in FIRE assets must be explicit.

## Current workflow conventions

These conventions describe the current prototype and agreed product direction.
They define behavior without prescribing production storage or architecture:

- A User can Create Entity (a name and Entity time zone; it starts empty) and
  switch between their Entities in the web app; the API and MCP name the Entity on
  every call. Deleting, archiving or copying an Entity and any sharing permissions
  are deferred ([TDD 04](docs/tdds/04-multiple-entities.md)).
- Activity can be recorded before a Review is created. Income and fixed-cost
  entries can select a stable source/category or remain Unassigned for unplanned
  activity, with a descriptive note. Recording them never requires a Plan change.
- A scenario is a copied named Plan. Child-cost scenarios add/change detailed
  fixed-cost lines and compare saved versions. Copied Income sources receive new
  identities; shared fixed-cost lines retain their identities.
- Goal funding uses remaining saved against its target, including designated
  opening savings and net reassignments. Contribution history remains separate.
  In the prototype, tag edits affect new contributions;
  historical contributions preserve the tag recorded when created.
- Fixed-cost, spending, and giving payments may be negative to represent refunds.
  Ordinary Income receipts and saving/investment contributions are nonnegative.
  Signed adjustments correct recorded amounts; they are not withdrawals or refunds.
  The agreed funding-origin workflow below adds savings used for recorded outflows.
  The prototype supports linked savings use and simple savings-account transfers. Independent withdrawals remain deferred.
- Goals, Investments, and Charitable giving are parallel workspaces. Investments
  and giving recipients have optional cumulative contribution targets and preserve
  history when inactive. Plans allocate investing by destination, saving by goal or account’s Unallocated savings, and giving by recipient.
- Investment balances live in Investments as separate dated observations. They may
  reference an investment but never enter contribution totals or target progress.
- Earlier investing and giving entries without a named destination stay Unassigned
  until explicitly assigned. They remain included alongside named entries in Reviews.
- Review checkpoints are freely set or cleared personal annotations with an
  optional takeaway. Subsequent relevant changes can show an informational
  indicator without clearing the annotation; unknown amounts remain unknown.
- Browser storage plus export/restore supports prototype continuity. It is not
  production persistence, authentication, or cross-device synchronization.

## Funding origins — agreed direction

Each recorded outflow identifies both what the money was used for and where it
came from. Fixed costs, guilt-free spending, giving, saving, and investing retain
their categories and destinations. Funding origin identifies current income or
previously saved money assigned to a saving goal, including Unallocated, in a
named savings account. The goal identifies the purpose of that saved money; a goal and an account are not interchangeable. A
funding origin belongs to the same Entity as the outflow.

- Setting aside income is new saving, whether or not money physically moves
  between bank accounts. Moving money already set aside does not count as new
  saving again.
- Using savings never creates an Income receipt or increases actual net income.
  Record the expense or investment contribution once, linked to its savings
  origin. Editing or deleting the outflow updates its linked savings use, so
  monthly activity and remaining saved stay consistent.
- Spending and giving totals include the full payment regardless of origin.
  Reviews retain the full comparison with the linked Plan and separately explain
  the amount funded from savings. Funding an expense from savings does not
  silently change the Plan or erase its spending difference.
- Investments show the full contribution in destination history and contribution
  progress. Reviews distinguish the part funded from current income from the part
  funded from previously saved money; the latter is not another allocation of
  this month's income. The same money must not count as newly saved twice.
- The existing recorded-net-cash-flow measure remains income less recorded
  outflows. Savings used is shown separately to explain funding; it is not added
  to income. Any view of the amount funded from current income must be labeled
  separately from total outflows and from an account balance.
- Goal contribution progress records what was contributed. Savings used reduces
  remaining saved without erasing that history or implying that a successfully
  funded purchase was a failure to save. Bank balances are not inferred from goal
  totals or account tags.
- Adjustments remain corrections to recorded activity, not a substitute for
  recording savings use. Corrections to outflows must keep their funding origins
  consistent as well as their category totals.

For example, a Laptop goal has $1,000 contributed in prior months. Recording a
$1,000 laptop purchase uses guilt-free spending as its category and the named
savings account, associated with the Laptop goal, as its funding origin. Spending
increases by $1,000; savings used is $1,000; income is unchanged. The goal shows
$1,000 contributed, $1,000 used, and $0 remaining. If the money instead goes to an
investment, that investment records a $1,000 contribution funded from savings,
without counting it as $1,000 newly allocated from current income.

The prototype supports a single origin per outflow with an explicit tracked goal
for new saved-money origins. Legacy label-only records remain preserved.
Savings and investment accounts have dated opening amounts as agreed below.
Account selection remains an interaction decision. Split funding within one
entry is deferred; the single-origin workflow is intentional. Naming
an account as an origin does not imply bank integration or balance reconciliation.

## Opening savings and investment accounts — agreed direction

Savings accounts and investment accounts have an explicit opening amount and
as-of date. This records the position when tracking starts without inventing
historical receipts or contributions. Opening amounts do not enter monthly
income, saving, investing, or spending actuals, and do not count toward
cumulative contribution targets.

- A savings account opening amount establishes the starting amount of saved
  money that can fund subsequent activity. For example, $1,000 already held
  followed by a $1,000 laptop purchase leaves $0 remaining, without a new income
  or saving entry.
- An investment account opening amount establishes its initial observed value.
  For example, an account opening at $25,000 followed by a $1,000 contribution
  has $1,000 of recorded contribution progress. Its current market value must
  come from a dated balance observation; it is not assumed to be $26,000.
- Activity already reflected in an opening amount must not be added a second
  time to the starting position. The opening amount represents the start of its calendar date; same-day
  activity applies afterward. Backdated changes follow the ordered historical
  validation rules below. Investment and debt observations remain separate from
  contributions/payments; this boundary does not make their balances automatic.

Each saving goal belongs to exactly one savings account in current scope. An
account holds goals including its mandatory Unallocated goal. A goal does not span
accounts; cross-account goal funding or relocation requires a later explicit
workflow and must not rewrite recorded history by merely changing an account
label. Goal amounts are portions of their account's saved money, not separate
assets to add on top of it.

Opening savings may be designated to goals, with the remainder retained as
unallocated savings in the same savings account. For example, $10,000 opening savings
may comprise $5,000 for Emergency fund, $1,000 for Laptop, and $4,000 of unallocated
savings. These are portions of the same $10,000, not additional money. A goal's
designated opening amount establishes its starting remaining saved without
inventing a contribution in the current month or historical contribution activity.
Account totals must not add goal designations a second time. Designations cannot
collectively exceed the recorded money available in the account. Using unallocated
savings money reduces the account's remaining saved and its undesignated portion,
without changing other goals' remaining amounts or creating income. Existing saved
money can also be reassigned between goals and unallocated savings within the account,
without changing the account total or recording new contributions.
The prototype implements account openings and initial goal designations.
Legacy account labels are preserved separately, without inferred balances.

## Debt accounts

Current Debt account scope covers loans. Credit-card debt, repayment tracking,
and settlement workflows are deferred. This does not require recording the
payment method for ordinary purchases.

Debt accounts are peers of savings and investment accounts. Each has a name,
a dated opening amount owed, and dated updates of the amount owed. Recording an
opening debt is not a current-month payment, expense, or income receipt.

### Record a debt payment

- **Actor:** the person using Accanto.
- **Command:** Record debt payment, with date, amount, Debt account, and funding
  origin of current income or savings.
- **Event:** Debt payment recorded.
- **Policy:** count the payment once in recorded outflows. A savings-funded
  payment and its linked savings use succeed or fail together.
- **Policy:** do not subtract the payment automatically from the observed debt
  balance. Interest and fees can make the principal reduction different from
  the cash payment.

### Record the amount owed

- **Actor:** the person using Accanto.
- **Command:** Record debt balance observation, with Debt account, date, and
  amount owed.
- **Event:** Debt balance observation recorded.
- **Policy:** preserve the dated observation separately from payments. Updating
  the amount owed neither creates an outflow nor changes recorded payments.

For example, a car loan opens at $10,000 owed. Recording a $300 payment creates
one $300 outflow. The user may separately record a later statement showing
$9,750 owed; Accanto does not assume that the payment reduced debt to $9,700.

Principal/interest splits, automatic debt-balance calculations, and repayment
projections are deferred. Loan payments belong to fixed costs and link to the relevant Debt account. Credit-card debt and settlements are outside current scope. If introduced later,
their design must avoid counting a purchase and its settlement as spending twice.
The prototype supports loan openings, payment history and separate observations.

## Destination allocations

Monthly allocation differences do not carry forward automatically. An unmet or
exceeded saving, investing, or giving allocation stays visible in that month's
Review; it does not modify a later month's Plan or saved comparison. Cumulative
destination progress continues to follow actual contributions, refunds, and
applicable adjustments. Catch-up allocations require an explicit Plan edit and,
for comparison, selection of the intended saved version.

For example, $200 planned for Laptop and $150 contributed in October leaves a
$50 shortfall in October. November remains $200 when compared with the same
planned allocation; it does not automatically become $250. The goal retains the
$150 of recorded contribution progress.

Plans allocate saving to goals or an account’s Unallocated savings, investing
to investment destinations, and giving
to named recipients. For
example, $300 to Emergency fund and $200 to Laptop produce $500 planned saving;
$700 to Retirement and $300 to Brokerage produce $1,000 planned investing.
A goal's Saving target is separate from these monthly Plan amounts.
Giving follows the same destination-comparison pattern: for a $500 tithe target,
a Plan may allocate $400 to Church and $100 to Food bank. Actual donations match
recipient identities, allowing both recipient and category comparisons. The
calculated tithe remains visible as the overall giving target. Recipient
allocations may be above or below it; show the difference without requiring
equality. Planned giving and unassigned money use the allocated total, not the
tithe target. For example, a $500 target and $450 allocated reserve $450 for
giving and show a $50 shortfall from target. These destination allocation inputs
and comparisons are now implemented in the prototype.

Loan payments are fixed-cost Plan lines linked to the relevant Debt account.
Their actual entries count once in fixed-cost totals and also appear in that
debt's payment history. This does not automatically calculate the amount owed.

### Saving-category adjustments require a goal

Every saving-category actual entry, including positive, negative, and zero
adjustments, identifies exactly one saving goal. When entering a known total
for saving, explicitly select the goal to receive the difference; Unallocated
is a valid choice within a selected account. The adjustment updates monthly
saving actuals and the selected goal/account's remaining saved together, without
changing other goals or creating a second account-level entry. Apply ordinary
lifecycle, date, nonnegative-history, concurrency, audit, and retry rules.

Example: $400 of recorded monthly saving corrected to $500 creates a +$100
saving adjustment assigned explicitly to Laptop or a selected account's
Unallocated goal. It increases that goal and its account by $100. It is not a
balance reconciliation adjustment, which corrects remaining saved without
changing monthly contribution totals. No default account is implied.

### Mandatory Unallocated goal — agreed storage and domain direction

Every savings account is created together with exactly one ongoing Unallocated
goal. Its reserved role, not its display name, identifies it. It has no target
and cannot be inactivated, completed, archived, or deleted independently of the
account. This does not require a default savings account for the Entity.

Every saved dollar is assigned to a goal. Opening money not designated to other
goals belongs to Unallocated; opening designations across all goals equal the
account opening amount. Do not count the opening amount and its designations
as separate assets. Account remaining saved is the sum across its goals,
including Unallocated exactly once. Completing a finite goal returns remaining
money to the same account’s Unallocated goal atomically with completion.

Saving allocations and contributions, savings-funded outflows, reassignments,
transfers, and balance reconciliation identify goals explicitly. The account is
determined by each goal. Planned use of savings remains an account-level funding
intention, not recorded savings activity. Earlier descriptions of “goals or
Unallocated savings” distinguish purposes in the UI, not separate record types.
This supersedes the earlier goal-less Unallocated savings model; prototype
account labels and optional goal associations are not the production model.

### Plan and record additions to Unallocated savings

An account's Unallocated savings is a valid monthly saving allocation alongside
named goals. For example, $300 to Emergency fund, $200 to Laptop, and $100 to
Unallocated savings in a named account produce $600 planned saving. Actual new
saving contributions to Unallocated savings reference that account’s Unallocated
goal, count once in monthly saving actuals, and increase that goal’s remaining
saved and contribution history. They do not increase other goals’ progress.
Reassigning that money to a goal later remains a reassignment, not another new
contribution. The prototype implements account-based allocation and contribution.

## Finite and ongoing saving goals

A finite goal such as Laptop has a funding target. An ongoing goal such as Home
repair remains available for repeated saving and use, and may have an optional
amount to keep on hand. Reaching either target means funded; it does not end the
goal or stop planned allocations automatically. A goal with no target shows its
remaining saved without a percentage or a funded/not-funded threshold.

The person can explicitly mark a finite goal completed and archive it. Preserve
its recorded contributions, uses, reassignments, and historical Plan links.
Ongoing goals do not automatically complete when funded or when money is used.
When completing the goal, explicitly show any positive remaining saved that will
return to Unallocated savings in the same account. Record that reassignment and
archive the goal as one operation; either both succeed or neither does. The
account total stays unchanged. This is not income, spending, or a new saving
contribution, and it does not rewrite historical Plan allocations. A goal with
zero remaining saved needs no monetary reassignment.

For example, assigning $1,000 of opening savings to a $1,000 Laptop goal makes it
funded immediately, with no new contribution. Buying the laptop uses the money;
the person may then mark the purpose completed and archive the goal. Home repair
can instead be replenished after each repair and remain active indefinitely.

### Complete a saving goal

- **Actor:** the person using Accanto.
- **Command:** Complete saving goal, showing the amount to return to the linked
  account's Unallocated savings before the action is submitted.
- **Event:** Saving goal completed; where money remains, Saved money reassigned
  describes the linked reassignment.
- **Policy:** return positive remaining saved to Unallocated savings in the same
  account and archive the goal, preserving contribution and use history.
- **Policy:** completion does not silently remove, redirect, or change any Plan
  allocation. Preserve saved versions and their Review comparisons. When editing
  a draft that allocates to the completed goal, flag that line so the person can
  explicitly remove it or redirect the amount. Draft totals retain the allocation
  until that explicit edit; the flag itself neither moves money nor changes a Plan.
- **Consistency rule:** completion, archival, and any reassignment succeed or
  fail together. No account total or monthly financial actual changes.

Example: Laptop received $1,000 and its purchase used $900. Completion shows
“Return $100 to Unallocated savings,” reassigns that $100, and archives Laptop
with $0 remaining. The $900 purchase and $1,000 contribution history stay intact.

## Planned use of savings and lump-sum income

Monthly Plans accept multiple net-income sources directly and separate planned
use of savings lines. Each savings funding line identifies a savings account and
an amount. Total planned funding is net income plus planned use of savings;
allocations to fixed costs, giving, guilt-free spending, saving, and investing
use that combined amount. The tithe target remains based on planned net income,
not savings funding. Unassigned Plan amount is total planned funding less all
allocations. Never implicitly assume savings cover an overallocated Plan.

Percentage definitions and defaults are governed by the metric decisions below.
The previously explored **Include in fixed-cost percentage** option remains a
candidate way to select a funding base, not a required control or settled default.
It must never change income, total funding, actual activity, or the tithe target.

A receipt counts as income once, on its actual date. Including later savings use
in a planning ratio does not count it as income again. Withdrawing or reassigning
existing savings is not new saving. Do not add planning bases across months and
present that sum as actual income.

For example, April can plan $4,000 net salary plus $1,000 from Bonus savings,
giving $5,000 to allocate. Planned income remains $4,000. A laptop purchase,
parental leave, or retirement spending can use the same generic mechanism.
A special lump-sum receipt link or funding schedule is not required.

Saving a Plan records an intention, not a transfer, receipt, or expense. Moving
existing cash between accounts does not create income or count as spending.
Actual outflows retain their savings funding origin and reduce recorded savings
once, under the existing savings-use rules. A Plan's funding line does not create
a second withdrawal or automatically record monthly activity. Monthly Reviews
use only their linked saved Plan version; scenarios remain independent and do
not reserve cash across Plans. Saved versions preserve their funding assumptions.

Record a lump-sum receipt once, in full, on its actual date. Hold unused money as
savings and plan later use through the same account-and-amount funding lines.
Expected receipts can inform scenarios but do not establish cash. The agreed
default remains to begin using a lump sum after receipt. An optional future helper
could spread a chosen portion over months; it is not a prerequisite for the
generic funding model. Cross-month guidance and overcommitment checks still need
design, without confusing independent scenarios with cumulative commitments.

The prototype replaces receipt-linked lump-sum spreading with generic savings
funding and separates income estimates from direct monthly net-income entry.
Historical saved inputs and results must be preserved. Annual Plans and annual
Reviews remain deferred.

## Percentage metrics — explicit choices before defaults

Agreed approach: define financial amounts precisely, show the amounts and formula
behind every displayed percentage, then revisit defaults after reviewing a few
months of data. Do not settle a default by silently redefining income, saving,
or investing. These open choices do not require a generic metric-builder UI.

| Metric | Numerator choices to evaluate | Denominator choices to evaluate |
| --- | --- | --- |
| Fixed-cost percentage | All fixed costs, or only fixed costs funded from current income | Net income; total funding; or net income plus selected savings funding |
| Saving percentage | New saving from income, or net saving after subtracting savings used | Net income or an explicitly described broader funding base |
| Investment percentage | All investment contributions, or only contributions funded from current income | Net income; total funding; or an explicitly selected funding base |

Keep Plan metrics and actual metrics separate. A planned ratio uses planned
amounts; an actual ratio uses recorded amounts for the same period. Never use a
planned savings allowance as if it were an actual receipt or actual savings use.
An actual broader funding base, if shown, must explicitly identify its recorded
components. Unknown or incomplete required amounts must not be treated as zero;
show the percentage as unavailable when its denominator is zero or unknown, or
its required numerator is unknown/incomplete.

Label each displayed percentage with its formula, for example **Fixed costs ÷
planned net income**, and make its component amounts visible. A selected-savings
base must disclose which funding is included. Changing a metric presentation
must not change actual entries or silently rewrite saved Plan assumptions/results.
The tithe target remains its separately defined calculation; these choices do
not automatically redefine giving targets or every percentage in the app.

Examples to retain when evaluating defaults:
- $2,500 fixed costs divided by $4,000 net income is 62.5%; including $1,000 of
  deliberately selected bonus savings in the base gives 50%. Both formulas must
  identify their different bases rather than both being called a share of income.
- Setting aside $500 from salary and using $1,000 of existing savings means $500
  new saving and -$500 net saving. Neither measure is an observed account balance.
- Investing $2,000 from existing savings means $2,000 total investment
  contributions and $0 contributions funded from current income. It is not new
  income or new saving. Savings used includes this recorded investment outflow.

The prototype shows planned income and total-funding comparisons, and separate
actual income-based comparisons for all/income-funded costs and investments,
new saving and net saving. Defaults remain provisional for evidence from use;
precise meanings and transparent formulas are agreed.

## Workflow finalization interview

The logical model is the agreed baseline for schema translation, summarized in
[the technical design](docs/tdds/01-mvp.md#data-model). Finalize workflow behavior
here one decision at a time, with a concrete example and recommendation. Existing
commands, events, and policies above remain agreed unless explicitly revised;
open questions below are not implementation rules or approvals of defaults.

For each workflow record intent/actor, command and inputs, successful domain
outcome/event, policies, atomic changes, correction/failure behavior, and a worked
example. These descriptions guide UI, API, schema constraints, and tests; they
do not require event sourcing, messaging infrastructure, or process managers.

Interview order:
1. Start tracking accounts: opening-date boundary, backdated activity, corrections.
2. Estimate monthly net income and explicitly use the result in a Plan.
3. Create/copy/edit a Plan: direct net sources, savings funding, allocations,
   visible percentage formulas, and immutable saved versions.
4. Record/correct activity across income, saving, investing, giving, purchases,
   refunds, and debt payments; preserve origin and destination effects.
5. Reassign savings, complete goals, and retire/restore accounts and destinations.
6. Start/retarget/annotate a monthly Review and explain unknown/incomplete actuals.

After these workflows are finalized, bring the prototype into alignment and
review complete journeys. Percentage defaults remain open for a few months of
observed use; workflow finalization does not require deciding them now.

### Decision 1 — Opening-date boundary (agreed)

An account's opening amount represents its position at the start of the selected
calendar date. Same-day activity occurs after that opening position. For savings,
$5,000 opening on October 1 plus a $200 contribution dated October 1 leaves
$5,200 remaining saved. Do not count that contribution as already included in
the opening amount. Investment and debt opening amounts remain observations;
contributions/payments do not automatically calculate later observed balances.

### Decision 2 — Activity before the opening date (agreed)

Reject account-linked activity dated before that account's opening date. This
also applies when editing an existing entry's date or account. Choose a sufficiently
early opening date and its correct starting amount during setup if earlier history
is needed. Once activity is recorded, the opening boundary is fixed for v1 under
Decision 22; there is no workflow to move it backward and rebuild history.
The rule does not prohibit unrelated older activity elsewhere in the Entity.
Same-day activity remains valid under Decision 1.

### Decision 3 — Reconcile a recorded balance (agreed)

- **Actor:** the person using Accanto.
- **Command:** Record balance reconciliation adjustment for one saving goal or an account’s
  Unallocated savings.
- **Event:** Balance reconciliation adjustment recorded.
- **Policy:** preserve the original opening amount. Record a signed adjustment
  dated when the selected savings amount is reconciled; do not backdate it to rewrite the opening
  position. Earlier balances remain unchanged.
- **Policy:** include the adjustment once in recorded savings remaining. Exclude
  it from income, spending, new saving, savings used, and investment/giving
  contribution totals. It is separate from a Review category adjustment.
- **Consistency rule:** save the adjustment and its audit record together.

Example: Unallocated savings has $5,000 opening plus a $200 contribution,
giving $5,200 recorded in that pot.
Reconciling to $5,000 records a -$200 balance adjustment on the reconciliation
date. The $200 contribution and original opening amount remain unchanged.
Saved Plan versions are unchanged. Investment and debt accounts continue to
use dated balance observations; this decision does not infer balances from their
contributions or payments.

Reconciliation targets one explicit pot under Decision 8 below. Decision 22
defers moving the opening boundary once activity has been recorded; reconciliation
does not rewrite that boundary or the original opening amount.

### Decision 4 — Sufficient savings and transfers (agreed)

Savings accounts, their goals, and Unallocated savings must not go negative.
A person must first establish enough recorded funds at the source before a
purchase, investment, donation, debt payment, transfer, reassignment, or negative
balance reconciliation adjustment reduces that source. This supersedes the
previous policy allowing negative savings with a warning. A planned allocation
is an intention, not a funded reservation; overallocation rules for Plans remain
unchanged. Corrections and deletion must not bypass the sufficient-funds rule.

### Record a savings transfer

- **Actor:** the person using Accanto.
- **Command:** Record savings transfer with date, positive USD amount, source
  account and goal/Unallocated savings, destination account and goal/Unallocated
  savings, and optional note.
- **Event:** Savings transferred, only after both sides are recorded successfully.
- **Policy:** accounts are different and belong to the same Entity. Each selected
  goal belongs to its respective account. The date is not before either account's
  opening date. Movement within one account remains a reassignment.
- **Policy:** decrease the source and increase the destination by the same amount.
  Total Entity savings is unchanged. Neither side creates income, spending,
  new saving, savings used for an outflow, or investment/giving contributions.
  A transfer does not move a goal's account association or rewrite a Plan.
- **Consistency rule:** sufficient-funds validation, both balance effects, and
  the audit record succeed atomically. Concurrent operations cannot each spend
  the same available savings. This records a transfer; it does not execute a
  bank payment or require bank integration.

Example: transfer $200 from Account A's Unallocated savings ($500) to Account B's
Laptop goal ($800). A's pot becomes $300 and Laptop becomes $1,000. The person can
then record the $1,000 laptop purchase. The transfer counts as no new saving.

### Decision 5 — Backdated transfers (agreed)

A backdated savings transfer is allowed only if its source account and selected
pot had sufficient recorded funds on the transfer date, and the transfer leaves
subsequent recorded account and pot balances nonnegative. A later contribution
cannot fund an earlier transfer. Validate the affected history and record both
sides atomically; reject without partial changes when the rule fails.

Example: September savings of $100 plus an October $400 contribution gives $500
now, but cannot fund a $200 transfer dated in September. Likewise, reject an
otherwise funded backdated transfer if it leaves insufficient money for a later
already-recorded use.

Financial dates have day precision. Within each date, use stable recording
order under Decision 9; users do not enter transaction times.

Transfer deletion follows Decision 6 below. No silent
movement between goals is authorized to cover a shortfall.

### Decision 6 — Delete recorded activity (agreed)

- **Actor:** the person using Accanto, through UI or API.
- **Command:** Delete recorded entry or savings transfer.
- **Event:** Recorded entry deleted or Savings transfer deleted, after success.
- **Policy:** soft-delete the record and exclude its effects from financial totals.
  Retain the original record and audit history; this is not a new compensating
  income, spending, or balance-adjustment entry.
- **Policy:** remove an outflow's linked savings use with that outflow. For a
  transfer, remove both account/pot effects together; never delete one side alone.
- **Policy:** validate the affected dated savings history without the record.
  Reject if an account, goal, or Unallocated savings would become negative at the
  affected date or any later recorded point. Explain the affected pot, date, and
  shortfall; do not change other activity or silently move its funding origin.
- **Consistency rule:** validation, deletion effects, and audit recording occur
  atomically under concurrency protection. On rejection, nothing is deleted.
- **Boundary:** saved Plan versions remain immutable. Archive accounts and
  destinations rather than deleting their history. A dedicated trash/restore
  interface is deferred; this does not require one to ship deletion. Any supported
  undo/restoration must revalidate domain rules, not blindly toggle a marker.

Example: delete an accidental duplicate contribution if the remaining history is
valid. If a $200 transfer funded a later $200 Laptop purchase, deleting it is
blocked when Laptop would become negative. Correct the dependent history or
record legitimate missing funding at the appropriate date before retrying.

### Decision 7 — Delete a purchase with linked refunds (agreed)

Reject deletion of a purchase while it has any non-deleted linked refund. Explain
that the person must delete those refunds first. Do not cascade-delete refunds
or silently detach their purchase link. Soft-deleted refunds retain historical
references but no longer prevent purchase deletion.

Each refund deletion is a separate explicit operation subject to Decision 6:
remove its financial and restored-savings effects together, validate affected
savings history, and save the deletion and audit record atomically. If refund
deletion would create negative savings, reject it and leave the purchase and
refund unchanged. After all linked refunds are deleted, purchase deletion still
requires its own normal domain validation.

Example: a $1,000 purchase with a $200 refund cannot be deleted first. Delete the
$200 refund if permitted, then delete the purchase. This order does not waive
sufficient-funds checks or automatically authorize any other changes.

### Decision 8 — Reconcile an individual savings amount (agreed)

Reconciliation targets exactly one saving goal or an account's Unallocated
savings. There is no command to reconcile the physical/bank account total and
then distribute its difference. Select the individual amount to reconcile,
compare its recorded remaining saved with the known amount, and record the
signed difference dated at reconciliation. There is no default attribution from
an account-wide correction and no automatic redistribution between pots.

The adjustment changes the selected pot only. The account's recorded total
changes by the same amount through its rollup of all goals, including Unallocated
exactly once.
This is one adjustment, not a second account-level entry. Preserve opening
amounts and earlier history, exclude it from income/spending/contributions, and
enforce the existing nonnegative-balance and atomic-audit rules. The physical
bank balance is not independently reconciled or verified by this workflow.

Example: Laptop has $1,000 and Unallocated savings has $4,200. Reconcile
Unallocated savings to $4,000: record -$200 against Unallocated savings. Laptop
stays $1,000; the account rollup becomes $5,000. Reconciling Laptop instead
requires explicitly selecting Laptop and supplying its own known amount.

### Decision 9 — Same-day savings activity order (agreed)

Evaluate savings history by financial date, then stable recording order within
that date. Opening positions precede activity on their opening date. Funding must
be recorded before an outflow that depends on it; do not assume an unrecorded
contribution will arrive later that day. The person enters dates, not transaction
times. Preserve a deterministic recording order for successful operations;
technical ordering/concurrency mechanisms belong in the TDD.

Example: Laptop starts October 16 with $800. A $1,000 purchase entered first is
rejected without creating activity. Record the $200 contribution dated October 16,
then retry the purchase; it succeeds and leaves $0. Backdated edits and deletions
validate this same ordered history and all affected subsequent balances. Editing
an entry must not silently reset its recording order to bypass sufficient-funds
checks. A transfer is one atomic operation across both goals/accounts.

### Decision 10 — Save multiple income estimates (agreed)

The separate income estimator supports multiple named saved estimates per Entity.
Persist each estimate's entered assumptions so it can be reopened without
re-entering salary, withholding, payroll deductions, and payment frequency.
The result remains a monthly net-income estimate, not income actually received.
Edits to one estimate do not change other estimates, Plans, or actual entries.

For v1, the person manually copies/pastes or types the result into a Plan's
net-income source amount. There is no Use in Plan command, source mapping,
automatic application, linking, or synchronization. Existing Plan version
immutability remains unchanged. This decision does not introduce immutable
estimate versions or an estimate-to-Plan relationship.

### Decision 11 — Multiple incomes within an estimate (agreed)

Each saved estimate supports multiple named income lines, each with gross amount,
payment frequency, entered expected withholding, and payroll deductions. Show
monthly net estimates by line and their combined monthly net total. For v1,
subtract entered withholding/deductions; do not calculate tax liability from
combined income or infer additional tax effects between lines. Automatic tax
estimation remains deferred, even though a scenario groups the incomes together.

Example: a monthly $6,000 salary less $1,200 withholding and $300 deductions
contributes $4,500 net; another monthly $4,000 salary less $800 withholding and
$200 deductions contributes $3,000. The combined monthly net estimate is $7,500.
These are assumptions, not tax owed, actual receipts, or cash already available.

Persist the income lines with their saved estimate. They are scenario inputs,
not automatically linked Plan Income sources. Manual copy/paste into Plans
remains the only required handoff. Editing one saved scenario does not alter
another scenario, a Plan, or actual activity.

### Decision 12 — Edit and duplicate saved income estimates (agreed)

Saved income estimates are ordinary editable named scenarios. Saving changes
updates the selected estimate and its income lines with audit history; it does
not create an immutable estimate version. Duplicate estimate creates a separate
named copy of the assumptions and income lines so alternatives can be retained.
Editing either estimate leaves the other unchanged. Duplication creates no Plan,
income receipt, or relationship to Plan income sources. Save each operation and
its audit history atomically under the existing write rules.

### Decision 13 — Archive a savings account (agreed)

- **Actor:** the person using Accanto.
- **Command:** Archive savings account.
- **Event:** Savings account archived, with its goals archived together.
- **Policy:** require the recorded account balance to be zero before archival.
  Since goals cannot be negative and account totals sum goals, every goal,
  including Unallocated, must also be zero. First explicitly transfer money to
  goals in another account or record actual uses; archival moves no money.
- **Policy:** archive the account and its goals, including the mandatory
  Unallocated goal, together. This is account retirement, not a declaration that
  every goal's purpose was completed. Unallocated cannot be archived independently.
- **Policy:** preserve records, goal/account associations, history, and saved Plan
  comparisons. Prevent new activity in the archived account and its goals.
  Flag draft allocations and savings-funding lines referencing them for explicit
  revision; do not silently remove or redirect amounts or rewrite saved versions.
- **Consistency rule:** validate the zero balance and archive the account/goals
  with audit history atomically. Concurrent activity cannot bypass this check.

Example: an account holding $3,000 cannot be archived. Record a $3,000 transfer
from its goals to goals in another account; once its total and goals are zero,
archive it. The transfer history and previous Review comparisons remain visible.
Reopening follows Decision 14 below.

### Decision 14 — Reopen a savings account (agreed)

- **Actor:** the person using Accanto.
- **Command:** Reopen savings account.
- **Event:** Savings account reopened.
- **Policy:** restore the existing account and the goals made inactive by that
  account's archival, including its mandatory Unallocated goal. Goals already
  completed or independently inactive before account archival retain their prior
  state; do not reactivate them as a side effect.
- **Policy:** preserve account/goal identities, original opening amounts and
  dates, history, and saved Plan comparisons. Reopening creates no money movement,
  income, contribution, adjustment, or new opening position.
- **Policy:** reopen before recording missing activity, refunds, or corrections
  affecting the archived account. Subsequent changes still satisfy normal date,
  lifecycle, funding, and historical nonnegative-balance rules. Reopening is not
  permission to bypass those validations or to revive completed goals implicitly.
- **Consistency rule:** restore the account and eligible goals with audit history
  atomically. Preserve enough lifecycle information to distinguish goals archived
  with the account from goals already completed/inactive beforehand.

Example: Home repair and Unallocated were active when the account was archived;
Laptop was already completed. Reopening restores Home repair and Unallocated,
while Laptop stays completed. A linked refund may restore money to completed Laptop under Decision 16,
without reactivating it.

### Decision 15 — Refund versus deletion (agreed)

Keep both workflows with distinct meanings. Delete a mistaken record, such as an
accidental duplicate or a purchase that never happened. Record a refund when a
real purchase occurred and some or all of the money later returned. Do not use
deletion to represent a real return.

From the original purchase, Record refund takes an amount and financial date,
retains the purchase link and original funding origin, and records the refund in
its own month. It does not erase or rewrite the purchase or create income.
Example: a $1,000 October purchase and $300 November refund leave October's
$1,000 spending intact and record -$300 spending in November. A savings-funded
refund restores $300 to its original goal, without creating a new contribution.

Completed-goal refunds follow the explicit exception in Decision 16.
Archived-account reopening continues to follow Decision 14.

### Decision 16 — Refund into a completed saving goal (agreed)

Allow a refund linked to an existing purchase to restore savings to its original
completed goal without reopening that goal. Keep it completed/archived and
unavailable for new contributions. This is a narrow exception for linked refunds,
not permission for arbitrary activity in an archived goal.

Show the restored remaining saved even though the goal is completed. Allow an
explicit reassignment of that returned money to the same account's Unallocated
goal without reopening the completed goal. Do not automatically reassign it or
count it as new saving. Normal sufficient-funds, date/order, atomicity, audit,
and deletion rules still apply. The account must be active: if archived, reopen
it first under Decision 14. Reopening the account need not reopen the completed
goal to accept this refund.

Example: Laptop was completed after a $1,000 purchase. Record a linked $200
refund: Laptop remains completed with $200 remaining, spending falls by $200
in the refund month, and account savings increases by $200. Explicitly reassign
that $200 to Unallocated: Laptop returns to $0 and the account total is unchanged.
Completion required its original money to be returned at that time; later refunds
can give a completed goal a positive balance without undoing completion.

### Decision 17 — Cap linked refunds at the purchase amount (agreed)

The sum of non-deleted linked refund amounts must not exceed the original
purchase's recorded amount. Remaining refundable is the purchase amount less
that sum. Show this remaining amount when recording another refund. A purchase
with no refundable amount remaining cannot receive an additional refund.

Enforce the cap when creating or editing a refund and when editing the purchase
amount; reject a purchase reduction below its existing refund total. When editing
a refund, replace its old amount in the proposed total rather than counting both
old and new. Soft-deleted refunds do not consume the cap; any supported
restoration must revalidate it. Refund deletion still obeys savings-history rules.

Validate and persist atomically under concurrency protection, including racing
refunds and purchase edits. On rejection, preserve all existing entries and
explain the remaining refundable amount; do not silently truncate a refund.

Example: a $1,000 purchase with $300 already refunded allows at most another
$700. A $701 refund is rejected; a $700 refund succeeds if all other rules pass.
The cap prevents restoring more savings than the purchase originally used.

### Decision 18 — Preserve funding origin while refunds exist (agreed)

Reject a change to a purchase's funding origin while it has any non-deleted
linked refund. This includes switching between current income and savings, or
changing the savings goal/account. Do not silently move previously recorded
refunds to another origin. An unchanged origin is not blocked by this rule.

To correct the origin, explicitly delete linked refunds first, change the
purchase's origin, then re-record the refunds with their correct financial dates
if appropriate. Each action independently obeys normal lifecycle, refund-cap,
ordered savings-history, concurrency, and audit rules; this sequence does not
guarantee that each action will be permitted. Failed actions leave data unchanged.

Protect the check and write atomically against concurrent refund creation or
restoration. Explain that linked refunds must be removed before changing the
funding origin. Soft-deleted refunds retain their historical origin in audit
history and do not block the edit; any supported restoration must revalidate
consistency with the purchase's current origin.

### Decision 19 — Refund dates follow the purchase (agreed)

A linked refund's financial date must be on or after its purchase's financial
date. Same-day refunds are allowed; activity retains the stable recording order
specified in Decision 9. Reject an earlier refund date. Reject a purchase-date
edit that would place the purchase after any non-deleted linked refund.

Enforce the rule on refund creation and date edits, purchase-date edits, and any
supported restoration. Soft-deleted refunds do not constrain a current purchase
edit, but restoration must revalidate dates. Protect validation and write against
concurrent changes. Rejection preserves all records. Existing opening-date,
ordered sufficient-funds, refund-cap, and funding-origin rules still apply.

Example: a purchase dated October 10 may have a refund dated October 10 or later,
not October 9. With an October 12 refund recorded, moving the purchase to October
13 is rejected. The refund continues to affect its own financial month.

### Decision 20 — Archive a debt account (agreed)

Allow explicit archival only when the debt account's latest recorded amount
owed is $0. A payment does not calculate or establish that balance; record a
zero balance observation when the debt is paid off. Missing balance information
is not zero. Show the observation date so it is clear this is a recorded amount,
not a live verified lender balance.

Archiving preserves the account identity, payments, observations, and saved
Plan comparisons. Block new debt payments until the account is reopened. Flag
draft fixed-cost lines still allocating payments to it for explicit revision;
do not silently remove allocations or rewrite saved Plan versions. Archival
creates no payment, balance observation, or other financial activity. Validate
the latest balance and save the lifecycle change with audit history atomically.

Example: recording a final $300 payment alone does not permit archival if the
latest observed amount owed remains $300. Record an amount owed of $0, then
archive. Existing payment history and linked Review comparisons remain intact.

### Decision 21 — Investments need no regular-funding status (agreed)

An investment account can remain tracked without regular contributions. Do not
require or introduce a status change simply because contributions stop or occur
irregularly. Keep its dated balance observations visible and allow future
contributions under the normal rules. Monthly Plan allocations express whether
and how much the person intends to contribute; funding frequency is not account
lifecycle. No regular/irregular or funding-paused status is needed.

Example: an old retirement account holding an observed $50,000 stays tracked
while receiving no new contributions. The person may continue recording balance
observations without marking it inactive. This decision rejects using inactivity
to represent a pause in funding; it does not define actual account-closure rules
or alter giving-recipient and saving-goal lifecycle behavior.

### Decision 22 — Fix the opening boundary after activity (agreed)

For v1, the account opening boundary is fixed once account activity is recorded.
Choose the desired start date and correct starting amount during setup. Do not
move the opening date or reconstruct the opening position to import earlier
history after activity exists. Reopening an archived account does not reset this
boundary. Existing reconciliation rules correct savings through dated goal-level
adjustments, preserving the original opening position.

Example: an account opened October 1 with subsequent activity cannot later accept
September account activity or move its opening date to September. To track
September, select a September starting position during initial setup. Unrelated
older activity elsewhere in the Entity remains allowed. A workflow for rebuilding
opening balances and earlier account history is deferred beyond v1.

### Decision 23 — One balance observation per account/date (agreed)

For investment and debt accounts, keep one current ordinary balance observation
per account per financial date. Correcting that date's observed amount updates the
existing observation with audit history rather than adding another competing
observation. Preserve its previous value in the audit log; corrections remain
subject to normal authorization, stale-edit, and atomic-write rules.

Example: correct an investment's October 31 value from $50,000 to $50,200. There
is one current October 31 observation; audit history retains the original value.
This creates no contribution, payment, income, or spending. Uniqueness is enforced
under concurrency, not just by a UI check. Do not silently overwrite a concurrent
observation when a create request encounters the same account/date.

This decision removes same-date ambiguity for ordinary observations; it does not
authorize changing a protected opening position or bypassing account lifecycle
rules. Opening observations retain their separately agreed start-of-day meaning.

A protected start-of-day opening and one ordinary observation may coexist on the
opening date. The ordinary observation is the later observed position and takes
precedence when showing the latest balance for that date. It does not replace or
correct the opening. Payments and contributions never calculate either observation.

Example: a loan opens October 1 at $300 owed. After a payment that day, the person
independently observes $0 owed and records an October 1 ordinary observation.
Preserve both the $300 opening and $0 observation. The latest observed balance is
$0, so the normal debt archival rule can be satisfied without inventing a later
date. Another ordinary October 1 observation must correct the existing ordinary
observation with audit history, not create a duplicate or change the opening.

### Interview checkpoint — defer advanced income matching

Defer combining multiple receipt sources into one Plan comparison line. The
conversation did not finalize matching cardinality; the proposed one-to-one
simplification is not yet an agreed schema constraint. Preserve the existing
agreement that cross-Plan receipt matching is explicit and Review-local, without
changing or duplicating actual receipts. Do not introduce combining/splitting
controls while updating the prototype. Resolve minimum matching constraints before
implementing production Review matching.

The core workflow interview is sufficient to proceed to prototype alignment.
Further edge-case questions should be driven by concrete gaps found while
implementing or reviewing those workflows, rather than extending this interview
indefinitely. Percentage defaults, dedicated restoration interfaces, and advanced
matching remain deferred; retention and physical enforcement belong in technical
design. This checkpoint is not a claim that every production detail is resolved.

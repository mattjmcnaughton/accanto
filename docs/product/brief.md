# Accanto

Accanto is a financial companion for consciously directing money toward the life
we want. Its name is Italian for “beside” or “alongside.”

## Product direction

- Create a Conscious Spending Plan through a wizard, then review and edit it
  directly. Preview changes and explicitly save or discard them.
- Define rich-life intentions in giving, experiences, consumption, and saving.
  Link intentions to CSP allocations without counting the same money twice.
- Record contributions and dated balances to track actual progress. Keep these
  separate from planned allocations and projected balances.
- Explore FIRE targets, portfolio progress, and time-to-target scenarios that
  update immediately when assumptions change. Make assumptions visible and
  distinguish illustrative projections from live account data.
- Offer an AI sidebar companion during creation and review. It explains context,
  answers questions, and proposes changes. Applying a proposal changes a draft;
  saving the plan remains a separate, explicit user action.

## Design

Minimal and calm. The latest direction uses ink blue,
pale blue-gray, restrained raspberry accents, clear typography, and modest
corner radii. Prefer legible allocations and intention labels to illustrations.
The September 10 screenshot study explored 29 desktop and 4 mobile states.

## Current implementation

A FastAPI/React starter with database infrastructure and local/production serving.
The features above are not implemented. No AI provider, authentication, financial
account integration, or application data model has been chosen.

## Architecture decision

Use the `python-web` template with a composed React frontend, following Aleph's
structure. Postgres infrastructure is included.

The initial workflow specification assumed browser-only persistence. This is
historical product input, not a finalized storage decision for Accanto. Before
implementing persistence, decide what remains local, what the server stores,
and how households authenticate and authorize access. The presence of Postgres
in the scaffold does not imply that any plan data is currently saved there.

Sending context to an AI service is separate from saving a plan. The interface
must accurately state what is shared. Model credentials belong on the server.

## Initial delivery boundary

Manual data entry first; live account syncing remains unscoped. Implement the
creation/review core before adding account integrations or a full agent framework.
No model calls or provider charges occur in this scaffold.

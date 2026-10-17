import { createFileRoute } from "@tanstack/react-router";
import { type View, WorkspaceApp } from "../features/workspace/WorkspaceApp";
import { today } from "../features/workspace/domain";
import { loadWorkspace } from "../features/workspace/storage";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { view: View; month: string } => ({
    view: ["month", "activity", "plans", "goals", "investments", "giving"].includes(
      String(search.view),
    )
      ? (search.view as View)
      : "month",
    month:
      typeof search.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(search.month)
        ? search.month
        : today(loadWorkspace().state.timeZone).slice(0, 7),
  }),
  component: Home,
});
function Home() {
  const { view, month } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <WorkspaceApp
      view={view}
      month={month}
      navigate={(next, nextMonth) => void navigate({ search: { view: next, month: nextMonth } })}
    />
  );
}

import { createFileRoute } from "@tanstack/react-router";

// One address per screen, such as #/plans. The root route renders the workspace.
export const Route = createFileRoute("/$screen")({});

import { RouterProvider, createHashHistory, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { beginScreen } from "./lib/screenTiming";
import { routeTree } from "./routeTree.gen";
import "./ui/tokens.css";
import "./ui/ui.css";
import "./index.css";

const router = createRouter({ routeTree, history: createHashHistory() });
router.subscribe("onBeforeNavigate", ({ fromLocation, pathChanged }) => {
  if (fromLocation && pathChanged) beginScreen();
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
// Notifications only (TDD 20); registered after the first render, never blocking it.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

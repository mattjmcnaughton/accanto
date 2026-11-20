import type { Preview } from "@storybook/react-vite";
import { mswLoader } from "msw-storybook-addon/csf3";
import { MINIMAL_VIEWPORTS } from "storybook/viewport";
// The same global styles main.tsx loads, in the same order: the kit, then the shell.
import "../src/ui";
import "../src/index.css";
import { type ReactNode, useEffect } from "react";
import { type ThemeChoice, useTheme } from "../src/features/workspace/shared";
import { mockApi } from "../src/stories/mocks/api";

/** The toolbar drives the app's own theme setting, so the shell story follows it too. */
function Themed({ theme, children }: { theme: ThemeChoice; children: ReactNode }) {
  const [, setTheme] = useTheme();
  // biome-ignore lint/correctness/useExhaustiveDependencies: setTheme is a new function each render.
  useEffect(() => setTheme(theme), [theme]);
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--ink)" }}>
      {children}
    </div>
  );
}

const preview: Preview = {
  loaders: [mswLoader()],
  parameters: {
    // Every story reads the synthetic fixtures unless it sets its own `msw` handlers.
    msw: mockApi(),
    layout: "fullscreen",
    viewport: {
      options: {
        phone: {
          name: "Phone (390 px)",
          styles: { width: "390px", height: "844px" },
          type: "mobile",
        },
        ...MINIMAL_VIEWPORTS,
      },
    },
  },
  globalTypes: {
    theme: {
      description: "Light or dark tokens",
      toolbar: {
        title: "Theme",
        icon: "mirror",
        items: [
          { value: "light", title: "Light", icon: "sun" },
          { value: "dark", title: "Dark", icon: "moon" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: "light" },
  decorators: [
    (Story, { globals }) => (
      <Themed theme={globals.theme === "dark" ? "dark" : "light"}>
        <Story />
      </Themed>
    ),
  ],
};
export default preview;

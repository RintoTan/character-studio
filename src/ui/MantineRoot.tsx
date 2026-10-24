import { MantineProvider, type CSSVariablesResolver } from "@mantine/core";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { loadDeveloperSettings } from "../config/developerSettings";
import { buildTheme } from "./theme";

/**
 * The bridge between this app's theme and Mantine's.
 *
 * Two things have to stay in step, and neither is owned by Mantine:
 *   - the accent colour, which the user picks in the Developer Centre
 *   - light/dark, which lives on `documentElement[data-theme]`
 *
 * So the provider follows both instead of holding its own copy: a `data-theme` change is
 * observed, and an accent change arrives as an event dispatched by
 * `applyDeveloperSettings`. If either went the other way, the library would paint a
 * theme the rest of the app does not have.
 */
export const ACCENT_EVENT = "character-studio:accent";

function readAccent(): string {
  return loadDeveloperSettings().appearance.accentColor;
}

function readScheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function useAccent() {
  const [accent, setAccent] = useState(readAccent);
  useEffect(() => {
    const onAccent = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      setAccent(typeof detail === "string" && detail ? detail : readAccent());
    };
    window.addEventListener(ACCENT_EVENT, onAccent);
    return () => window.removeEventListener(ACCENT_EVENT, onAccent);
  }, []);
  return accent;
}

function useScheme() {
  const [scheme, setScheme] = useState<"light" | "dark">(readScheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setScheme(readScheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    setScheme(readScheme());
    return () => observer.disconnect();
  }, []);
  return scheme;
}

/**
 * Our tokens, handed to Mantine under the names it looks for. This is the whole reason
 * a Mantine button can sit next to a legacy one without a second neutral palette: both
 * end up reading `--surface`, `--text` and `--border`.
 */
const resolver: CSSVariablesResolver = () => ({
  variables: {
    "--mantine-color-body": "var(--surface)",
    "--mantine-color-text": "var(--text)",
    "--mantine-color-dimmed": "var(--muted)",
    "--mantine-color-placeholder": "var(--muted)",
    "--mantine-color-anchor": "var(--primary)",
    "--mantine-color-error": "var(--danger)",
    "--mantine-color-default": "var(--surface)",
    "--mantine-color-default-hover": "var(--control-fill-hover)",
    "--mantine-color-default-color": "var(--text)",
    "--mantine-color-default-border": "var(--border)",
    "--mantine-color-disabled": "var(--surface-subtle)",
    "--mantine-color-disabled-color": "var(--muted)",
    "--mantine-color-disabled-border": "var(--border)",
    "--mantine-primary-color-filled": "var(--primary)",
    "--mantine-primary-color-filled-hover": "var(--primary-hover)",
    "--mantine-primary-color-light": "color-mix(in srgb, var(--primary) 12%, transparent)",
    "--mantine-primary-color-light-hover": "color-mix(in srgb, var(--primary) 18%, transparent)",
    "--mantine-primary-color-light-color": "var(--primary)",
  },
  light: {
    "--mantine-color-dark-0": "#f4f4f5",
    "--mantine-color-dark-1": "#d4d4d8",
    "--mantine-color-dark-2": "#a1a1aa",
    "--mantine-color-dark-3": "#3f4654",
    "--mantine-color-dark-4": "#2b303b",
    "--mantine-color-dark-5": "#20242d",
    "--mantine-color-dark-6": "#ffffff",
    "--mantine-color-dark-7": "#f9fafb",
    "--mantine-color-dark-8": "#f3f4f6",
    "--mantine-color-dark-9": "#e5e7eb",
  },
  dark: {
    "--mantine-color-dark-0": "#f4f4f5",
    "--mantine-color-dark-1": "#d4d4d8",
    "--mantine-color-dark-2": "#a1a1aa",
    "--mantine-color-dark-3": "#3f4654",
    "--mantine-color-dark-4": "#2b303b",
    "--mantine-color-dark-5": "#20242d",
    "--mantine-color-dark-6": "#171a21",
    "--mantine-color-dark-7": "#0f1115",
    "--mantine-color-dark-8": "#0b0d11",
    "--mantine-color-dark-9": "#07080a",
  },
});

export function MantineRoot({ children }: { children: ReactNode }) {
  const accent = useAccent();
  const scheme = useScheme();
  const theme = useMemo(() => buildTheme(accent), [accent]);

  return (
    <MantineProvider theme={theme} forceColorScheme={scheme} cssVariablesResolver={resolver}>
      {children}
    </MantineProvider>
  );
}

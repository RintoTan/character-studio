import { createTheme, type MantineThemeOverride } from "@mantine/core";
import { BRAND_PRIMARY_SHADE, brandScale } from "./accent";

/**
 * Mantine's theme, built from the tokens this app already had.
 *
 * The rule for the whole migration: the component library borrows our numbers, it does
 * not bring its own. Sizes, radii and the type scale below are the values in styles.css
 * (14px body, 12px meta, 8px control radius, 34/42px control heights); the brand colour
 * is whatever accent the user picked, expanded to the ten steps Mantine needs.
 *
 * Nothing here paints; it only tells Mantine which of our values to use.
 */
export function buildTheme(accent: string): MantineThemeOverride {
  const scale = brandScale(accent);
  return createTheme({
    primaryColor: "brand",
    primaryShade: { ...BRAND_PRIMARY_SHADE },
    colors: { brand: scale },
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple Color Emoji", "Segoe UI Emoji", sans-serif',
    fontFamilyMonospace: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
    fontSizes: {
      xs: "11px",
      sm: "12px",
      md: "14px",
      lg: "16px",
      xl: "20px",
    },
    lineHeights: {
      xs: "1.35",
      sm: "1.45",
      md: "1.5",
      lg: "1.45",
      xl: "1.3",
    },
    headings: {
      fontFamily: "inherit",
      fontWeight: "650",
      sizes: {
        h1: { fontSize: "28px", lineHeight: "1.2" },
        h2: { fontSize: "20px", lineHeight: "1.3" },
        h3: { fontSize: "16px", lineHeight: "1.4" },
        h4: { fontSize: "14px", lineHeight: "1.45" },
        h5: { fontSize: "13px", lineHeight: "1.45" },
        h6: { fontSize: "12px", lineHeight: "1.45" },
      },
    },
    radius: {
      xs: "4px",
      sm: "6px",
      md: "8px",
      lg: "10px",
      xl: "14px",
    },
    defaultRadius: "md",
    spacing: {
      xs: "6px",
      sm: "8px",
      md: "12px",
      lg: "16px",
      xl: "20px",
    },
    // Our shadows are tokens because the dark theme uses a different opacity for the
    // same shape; referencing the variable keeps one definition of each elevation.
    shadows: {
      xs: "0 1px 2px rgba(15, 23, 42, 0.05)",
      sm: "0 2px 6px rgba(15, 23, 42, 0.06)",
      md: "var(--shadow)",
      lg: "var(--shadow-strong)",
      xl: "var(--shadow-strong)",
    },
    components: {
      Button: {
        defaultProps: { radius: "md" },
        styles: { root: { fontWeight: 600, letterSpacing: "0.01em" } },
      },
      ActionIcon: {
        defaultProps: { radius: "md", variant: "subtle" },
      },
      CloseButton: {
        defaultProps: { radius: "md" },
      },
      TextInput: {
        defaultProps: { radius: "md" },
      },
      Select: {
        defaultProps: { radius: "md" },
      },
      SegmentedControl: {
        defaultProps: { radius: "md" },
      },
      Tooltip: {
        defaultProps: { radius: "sm", withArrow: true, openDelay: 320, transitionProps: { duration: 120 } },
      },
      Menu: {
        defaultProps: { radius: "md", shadow: "md", withinPortal: true },
      },
      Modal: {
        defaultProps: { radius: "lg", shadow: "lg", centered: true, overlayProps: { blur: 2, backgroundOpacity: 0.45 } },
      },
      Drawer: {
        defaultProps: { radius: 0, shadow: "lg", overlayProps: { blur: 2, backgroundOpacity: 0.45 } },
      },
      Badge: {
        defaultProps: { radius: "sm" },
      },
    },
  });
}

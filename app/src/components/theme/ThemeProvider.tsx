import { colorBackgroundLayoutMain } from "@cloudscape-design/design-tokens";
import { applyMode, Mode } from "@cloudscape-design/global-styles";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  getPreferenceSnapshot,
  getSystemDarkSnapshot,
  setStoredPreference,
  subscribePreference,
  subscribeSystemDark,
  type ThemePreference,
} from "@/lib/theme";

interface ThemeContextValue {
  /** What the user chose: light, dark, or follow the browser. */
  preference: ThemePreference;
  /** What that currently resolves to - what Cloudscape is actually rendering. */
  resolved: "light" | "dark";
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return context;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSyncExternalStore(
    subscribePreference,
    getPreferenceSnapshot,
  );

  // Read unconditionally rather than only when preference === "system":
  // hooks can't be conditional, and an unused boolean costs nothing.
  const systemDark = useSyncExternalStore(
    subscribeSystemDark,
    getSystemDarkSnapshot,
  );

  const resolved: "light" | "dark" =
    preference === "system" ? (systemDark ? "dark" : "light") : preference;

  // Genuine "sync with an external system" effect - Cloudscape's mode is a
  // class on <body>, which React doesn't own. applyStoredColorMode() in main.tsx
  // has already set it for the first paint; this keeps it in step afterwards.
  useEffect(() => {
    applyMode(resolved === "dark" ? Mode.Dark : Mode.Light);
    // Cloudscape paints its own components but not <body>. The token is a
    // var() with a fallback, so this resolves correctly under either mode
    // without us hardcoding the hashed custom-property name.
    document.body.style.background = colorBackgroundLayoutMain;
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    setStoredPreference(next);
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

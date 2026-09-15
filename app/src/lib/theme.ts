// Cloudscape has no notion of "follow the browser" - applyMode() takes a
// concrete Light or Dark. So we store a three-way *preference* and resolve it
// against prefers-color-scheme ourselves before handing Cloudscape a mode.

export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "gpu_guardian_theme";
export const DARK_MODE_CLASS = "awsui-dark-mode";
export const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export const DEFAULT_PREFERENCE: ThemePreference = "system";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : DEFAULT_PREFERENCE;
  } catch {
    // localStorage throws rather than returning null when the browser blocks
    // storage entirely (Safari private mode, some enterprise policies).
    return DEFAULT_PREFERENCE;
  }
}

export function storePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Preference just won't survive a reload. Not worth failing the click.
  }
}

// --- External stores -------------------------------------------------------
// The preference lives in localStorage and the OS setting in matchMedia -
// both are outside React, so useSyncExternalStore is the correct primitive.
// No getServerSnapshot: this is a browser-only build with nothing prerendered
// for a first client render to disagree with.

const preferenceListeners = new Set<() => void>();

export function subscribePreference(onChange: () => void): () => void {
  preferenceListeners.add(onChange);
  // Fires when another tab writes the key, so the choice syncs across tabs.
  window.addEventListener("storage", onChange);
  return () => {
    preferenceListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Safe as a getSnapshot: returns a string, which React compares by value. */
export const getPreferenceSnapshot = readStoredPreference;

export function setStoredPreference(preference: ThemePreference): void {
  storePreference(preference);
  // The storage event doesn't fire in the tab that wrote it.
  preferenceListeners.forEach((listener) => listener());
}

export function subscribeSystemDark(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_MEDIA_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export const getSystemDarkSnapshot = prefersDark;

export function prefersDark(): boolean {
  return window.matchMedia(DARK_MEDIA_QUERY).matches;
}

export function resolvePreference(preference: ThemePreference): "light" | "dark" {
  if (preference === "system") return prefersDark() ? "dark" : "light";
  return preference;
}

/**
 * Sets Cloudscape's mode class on <body> for the first paint.
 *
 * Called from main.tsx before render rather than from a component, because a
 * dark-mode user whose class arrives one paint late sees the app flash white.
 * ThemeProvider owns every change after this one.
 *
 * This used to be a string of JavaScript inlined into the document, which the
 * static export needed: it shipped prerendered HTML carrying no mode class, so
 * the class had to be set before the bundle had even loaded. A single-page build
 * renders nothing until the bundle runs, so the entry module is early enough.
 */
export function applyStoredColorMode(): void {
  document.body.classList.toggle(
    DARK_MODE_CLASS,
    resolvePreference(readStoredPreference()) === "dark",
  );
}

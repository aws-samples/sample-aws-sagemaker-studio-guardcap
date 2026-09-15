"use client";

import type { ButtonDropdownProps } from "@cloudscape-design/components/button-dropdown";
import type { TopNavigationProps } from "@cloudscape-design/components/top-navigation";
import { useTheme } from "./ThemeProvider";
import { isThemePreference, type ThemePreference } from "@/lib/theme";

const LABELS: Record<ThemePreference, string> = {
  light: "Light",
  dark: "Dark",
  system: "Browser default",
};

/**
 * The compact color-mode control for TopNavigation.
 *
 * TopNavigation takes utilities as plain data, not children, so this is a hook
 * returning a descriptor rather than a component - there is nowhere to mount a
 * <ThemeSwitcher/> inside the bar. Both controls read the same context, so the
 * segmented switch on the settings surface and this menu never disagree.
 *
 * Checkbox items for a single-select is Cloudscape's own pattern for menus like
 * this: they render the tick that tells you which mode is active without
 * opening anything else. Clicking the already-checked item is a no-op rather
 * than an uncheck, because "no color mode" is not a state that exists.
 */
export function useThemeUtility(): TopNavigationProps.Utility {
  const { preference, setPreference } = useTheme();

  const items: ButtonDropdownProps.Items = (
    Object.keys(LABELS) as ThemePreference[]
  ).map((id) => ({
    id,
    text: LABELS[id],
    itemType: "checkbox",
    checked: preference === id,
  }));

  return {
    type: "menu-dropdown",
    iconName: "light-dark",
    ariaLabel: `Color mode: ${LABELS[preference]}`,
    title: "Color mode",
    items,
    onItemClick: ({ detail }) => {
      if (isThemePreference(detail.id)) setPreference(detail.id);
    },
  };
}

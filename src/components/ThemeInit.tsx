import { useEffect } from "react";
import { applyTheme, getStoredTheme, getStoredPrefs } from "@/lib/themes";

/** Client-only: applies the persisted theme + a11y prefs after hydration. */
export function ThemeInit() {
  useEffect(() => {
    applyTheme(getStoredTheme(), getStoredPrefs());
  }, []);
  return null;
}

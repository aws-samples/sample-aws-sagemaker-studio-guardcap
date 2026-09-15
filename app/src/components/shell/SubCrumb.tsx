import {
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from "react";
import type { Crumb } from "@/lib/nav";

type SubCrumbSetter = (crumb: Crumb | null) => void;

/**
 * Lets a page append one leaf to the breadcrumb trail that the shell owns.
 *
 * Needed because breadcrumbs are an AppLayout slot, so only the shell can
 * render them, while the label - a student id, say - is only known to the page.
 * The context carries the setter and nothing else, deliberately: a value object
 * would change identity whenever the crumb changed, re-running the effect
 * below, which would clear and re-set the crumb forever. A useState setter is
 * stable for the life of the shell, so the effect's deps are all stable.
 */
const SubCrumbContext = createContext<SubCrumbSetter>(() => {});

export function SubCrumbProvider({
  setSubCrumb,
  children,
}: {
  setSubCrumb: SubCrumbSetter;
  children: ReactNode;
}) {
  return (
    <SubCrumbContext.Provider value={setSubCrumb}>
      {children}
    </SubCrumbContext.Provider>
  );
}

/**
 * Registers `crumb` as the trail's last item for as long as the calling
 * component is mounted. Pass null to register nothing - a detail page whose
 * record hasn't loaded yet should show no crumb rather than a placeholder one.
 */
export function useSubCrumb(crumb: Crumb | null): void {
  const setSubCrumb = useContext(SubCrumbContext);
  // Destructured so the effect depends on two strings rather than an object
  // literal that a parent re-render would make new every time.
  const text = crumb?.text ?? null;
  const href = crumb?.href ?? null;

  useEffect(() => {
    setSubCrumb(text !== null && href !== null ? { text, href } : null);
    // Clearing on unmount is what stops a stale leaf from following the user
    // to the next page.
    return () => setSubCrumb(null);
  }, [setSubCrumb, text, href]);
}

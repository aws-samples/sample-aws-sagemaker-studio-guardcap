import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import { usePathname } from "@/lib/router";
import type { ReactNode } from "react";
import { findRoute } from "@/lib/nav";

interface PageLayoutProps {
  /** Primary buttons for this page, e.g. "Add student". */
  actions?: ReactNode;
  /**
   * Overrides the route's own heading. For a view the registry cannot name: the
   * student detail lives at `/students?student=id`, so its route is still
   * "/students" and the registry's title would read "Students" above one student.
   */
  title?: string;
  /** Overrides the route's description. Pass null to show none. */
  description?: string | null;
  children: ReactNode;
}

/**
 * The h1 and description for a page, read from the route registry rather than
 * passed in, so the side navigation label and the heading can never disagree.
 * Pass `actions` for the page's buttons - those are genuinely per-page.
 */
export default function PageLayout({
  actions,
  title,
  description,
  children,
}: PageLayoutProps) {
  const route = findRoute(usePathname());

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          // `undefined` means "not overridden" and falls back to the route;
          // an explicit null means "this view has no description".
          description={
            description === undefined ? route.description : (description ?? undefined)
          }
          actions={actions}
        >
          {title ?? route.title}
        </Header>
      }
    >
      {children}
    </ContentLayout>
  );
}

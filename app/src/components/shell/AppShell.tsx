import AppLayoutToolbar from "@cloudscape-design/components/app-layout-toolbar";
import BreadcrumbGroup from "@cloudscape-design/components/breadcrumb-group";
import type { ButtonDropdownProps } from "@cloudscape-design/components/button-dropdown";
import SideNavigation from "@cloudscape-design/components/side-navigation";
import TopNavigation from "@cloudscape-design/components/top-navigation";
import { usePathname, useRouter } from "@/lib/router";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { audienceForWho, useWho } from "@/components/auth/AudienceGate";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  AWS_LOGO_WHITE,
  useConfig,
} from "@/components/branding/BootstrapProvider";
import { NotificationBar } from "@/components/notifications/NotificationProvider";
import { useThemeUtility } from "@/components/theme/useThemeUtility";
import {
  activeNavHref,
  audienceOf,
  buildCrumbs,
  findRoute,
  homeHrefFor,
  navRoutesFor,
  type Crumb,
} from "@/lib/nav";
import { SubCrumbProvider } from "./SubCrumb";

const HEADER_ID = "top-nav";

const ACCOUNT_ITEMS: ButtonDropdownProps.Items = [
  { id: "sign-out", text: "Sign out", iconName: "sign-out" },
];

/**
 * Chrome shared by every signed-in page: the top bar, the side navigation and
 * the breadcrumb trail. Pages render only their own content.
 *
 * Navigation goes through the Next router rather than letting Cloudscape's
 * anchors do a full page load. Each `onFollow` calls preventDefault and pushes
 * instead, which keeps the client-side transition (and the in-memory auth
 * session, which a reload would destroy). The `href` values stay real so
 * middle-click, ctrl-click and the status bar preview all still work.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { config } = useConfig();
  const { user, signOut } = useAuth();
  const themeUtility = useThemeUtility();

  // Controlled, because contentType changes between routes and an uncontrolled
  // drawer would snap back to that route's default open state on every
  // navigation - collapsing a sidebar the user had deliberately opened.
  const [navigationOpen, setNavigationOpen] = useState(true);
  const [subCrumb, setSubCrumb] = useState<Crumb | null>(null);

  const route = findRoute(pathname);
  const activeHref = activeNavHref(pathname);
  // Taken from the signed-in user, per GET /whoami, and from the route only when
  // that answer is missing. It used to be route-derived because the token carries
  // no group claim under ORGANIZATION mode, which meant an admin who opened /me
  // lost the admin nav and had no link back. The backend now says which audience
  // this account is, so the nav can follow the person rather than the page.
  const who = useWho();
  const audience = who ? audienceForWho(who) : audienceOf(route);
  const homeHref = homeHrefFor(audience);

  const navigate = useCallback(
    (event: CustomEvent<{ href: string; external?: boolean }>) => {
      if (event.detail.external) return;
      event.preventDefault();
      router.push(event.detail.href);
    },
    [router],
  );

  const crumbs = useMemo(
    () => buildCrumbs(pathname, config.appShortName, subCrumb),
    [pathname, config.appShortName, subCrumb],
  );

  const navItems = useMemo(
    () =>
      navRoutesFor(audience).map((item) => ({
        type: "link" as const,
        text: item.text,
        href: item.href,
      })),
    [audience],
  );

  return (
    <>
      {/*
        AppLayout measures this element to work out where its own content
        starts, via `headerSelector`. Its default is "#b #h" - a convention from
        Cloudscape's own console shell that does not exist here - so the id is
        passed explicitly. Without it the top bar overlaps the first row of
        content. `sticky` keeps the bar visible while the content scrolls; the
        z-index is Cloudscape's documented value for this slot.
      */}
      <div
        id={HEADER_ID}
        style={{ position: "sticky", top: 0, zIndex: 1002 }}
      >
        <TopNavigation
          identity={{
            href: homeHref,
            title: config.appShortName,
            // Always the white variant: this bar is dark under both color
            // modes. Never undefined, unlike before - TopNavigation shows the
            // title alone without a logo, which reads as a half-loaded page.
            logo: {
              src: config.logoUrl || AWS_LOGO_WHITE,
              alt: config.appTitle,
            },
            onFollow: (event) => {
              event.preventDefault();
              router.push(homeHref);
            },
          }}
          utilities={[
            themeUtility,
            {
              type: "menu-dropdown",
              iconName: "user-profile",
              // Falls back through email then name: the id token always has a
              // sub, but either display claim can be absent depending on how
              // the Identity Center attribute mapping is configured.
              text: user?.email ?? user?.name ?? "Account",
              // The display name titles a group wrapping the actions, which is
              // how Cloudscape puts an identity inside a menu. The `description`
              // property looks like the obvious home for it but only renders in
              // the mobile overflow menu, so on desktop it would never be seen.
              items: user?.name
                ? [{ itemType: "group", text: user.name, items: ACCOUNT_ITEMS }]
                : ACCOUNT_ITEMS,
              onItemClick: ({ detail }) => {
                if (detail.id === "sign-out") signOut();
              },
            },
          ]}
        />
      </div>
      <AppLayoutToolbar
        headerSelector={`#${HEADER_ID}`}
        contentType={route.contentType}
        // Every page runs the full width of the window, whatever its contentType.
        //
        // Without this, Cloudscape caps a "dashboard" at 1280px on a 1401-1920px
        // display and leaves a "table" uncapped, so the same window shows the
        // dashboard in a centred column with ~180px of dead space each side and the
        // students table running edge to edge. The step is invisible below 1401px,
        // which is why it reads as a padding bug rather than a width rule.
        //
        // MAX_VALUE is Cloudscape's own sentinel for "no cap": it is compared by
        // identity and turns the max-width into 100%, rather than being used as a
        // pixel figure.
        maxContentWidth={Number.MAX_VALUE}
        navigationOpen={navigationOpen}
        onNavigationChange={({ detail }) => setNavigationOpen(detail.open)}
        // No tools drawer yet - the platform reference panel comes back with
        // the dashboard step. Hiding it removes the empty toggle button.
        toolsHide
        // Action outcomes surface here rather than inside the page: a suspend
        // takes a few seconds, and its result has to be readable from wherever
        // the admin has navigated to by the time it lands.
        notifications={<NotificationBar />}
        // Kept in view while the table is scrolled - an error about a student
        // three screens up is otherwise reported off-screen.
        stickyNotifications
        breadcrumbs={
          <BreadcrumbGroup items={crumbs} onFollow={navigate} />
        }
        navigation={
          <SideNavigation
            header={{ text: config.appShortName, href: homeHref }}
            activeHref={activeHref}
            items={navItems}
            onFollow={navigate}
          />
        }
        content={
          <SubCrumbProvider setSubCrumb={setSubCrumb}>{children}</SubCrumbProvider>
        }
      />
    </>
  );
}

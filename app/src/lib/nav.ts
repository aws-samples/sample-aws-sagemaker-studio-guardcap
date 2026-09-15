import type { AppLayoutProps } from "@cloudscape-design/components/app-layout";

// The one place routes are declared. Side navigation, breadcrumbs, the page
// heading and the AppLayout content type are all derived from this, so adding a
// page means editing one array instead of four call sites that can drift apart.
//
// Type-only import above: it compiles away, so this module stays free of React
// and of the component bundle, and can be unit-tested in plain Node.

/**
 * Who a route is for.
 *
 * The API has two audiences and they do not overlap: every route except GET /me
 * and GET /me/studio-url requires admin-group membership, and those two require
 * student-group membership - an admin is not in the student group and gets a 403
 * from them. So a student on the admin console sees nothing but errors, and the
 * side navigation must not offer them the trip.
 *
 * This is presentation only. Nothing here is an authorization decision: the API
 * checks group membership on every request and is the only thing that decides
 * what a caller may do. Hiding a link stops a pointless 403, not an attacker.
 */
export type Audience = "admin" | "student";

export interface NavRoute {
  /** Canonical path, no trailing slash. See normalizePath. */
  href: string;
  /** Side navigation and breadcrumb label. */
  text: string;
  /** Page <h1>. Often the same as `text`, but not required to be. */
  title: string;
  description: string;
  /**
   * Drives AppLayout's default padding and content width. "table" gives a
   * full-bleed table surface; "dashboard" tightens the header/content gap.
   */
  contentType: AppLayoutProps.ContentType;
  /**
   * Route this one sits under. Puts it in the breadcrumb trail and keeps the
   * parent's side-navigation item highlighted while it is open.
   */
  parent?: string;
  /**
   * False for a route reached from within a page rather than from the sidebar.
   * "Add student" is a step in a task, not a place; listing it beside Dashboard
   * and Students would imply otherwise.
   */
  showInNav?: boolean;
  /** Defaults to "admin": every route was one before the student page existed. */
  audience?: Audience;
}

export const ROUTES: readonly NavRoute[] = [
  {
    href: "/",
    text: "Dashboard",
    title: "Dashboard",
    description:
      "Platform health, student provisioning status, and aggregate AWS spend.",
    contentType: "dashboard",
  },
  {
    href: "/students",
    text: "Students",
    title: "Students",
    description:
      "Every provisioned student, their instance type, and spend against budget.",
    contentType: "table",
  },
  {
    href: "/students/new",
    text: "Add student",
    title: "Add student",
    description:
      "Provision a dedicated notebook environment, budget and enforcement policy for one student.",
    // "form" narrows the content column: a form is read down a single line, and
    // full-width fields on a wide monitor are harder to scan, not easier.
    contentType: "form",
    parent: "/students",
    showInNav: false,
  },
  {
    href: "/me",
    text: "My notebook",
    title: "My GPU notebook",
    // Addressed to the student, not about them: this is the only page in the app
    // whose reader is the subject.
    description:
      "Your notebook environment, what it has cost so far, and how much of your budget is left.",
    contentType: "dashboard",
    audience: "student",
  },
  {
    href: "/budget-alerts",
    text: "Budget and alerts",
    title: "Budget and alerts",
    description:
      "Budget thresholds and the alarm events that triggered enforcement.",
    contentType: "table",
  },
];

/**
 * Every href here is written without a trailing slash, but a URL can arrive with
 * one - typed, bookmarked from the previous build, or requested by the CDP suites.
 * Comparing raw strings would then silently fail to highlight the active nav item,
 * so every comparison goes through here first. The root path stays "/" rather
 * than becoming "".
 */
export function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export function audienceOf(route: NavRoute): Audience {
  return route.audience ?? "admin";
}

/**
 * The side-navigation items for one audience, in order.
 *
 * Filtered by audience rather than listing everything, so a student is never
 * offered Dashboard or Students - links that would answer with a 403 and read as
 * the console being broken rather than as not being theirs.
 */
export function navRoutesFor(audience: Audience): readonly NavRoute[] {
  return ROUTES.filter(
    (route) => route.showInNav !== false && audienceOf(route) === audience,
  );
}

/**
 * Where the product name in the top bar and the side-navigation header lead.
 *
 * "/" is the admin dashboard, so for a student it is the one link in the chrome
 * that would take them somewhere they are not allowed.
 */
export function homeHrefFor(audience: Audience): string {
  return audience === "student" ? "/me" : "/";
}

export function findRoute(pathname: string): NavRoute {
  const path = normalizePath(pathname);
  // Falls back to the dashboard rather than returning undefined: callers use
  // this for the shell's heading and content type, which an unknown path still
  // needs. The genuinely-missing case is NotFoundPage, which for that reason
  // does not use PageLayout.
  return ROUTES.find((route) => route.href === path) ?? ROUTES[0];
}

/**
 * Query parameter carrying the student id on the detail view.
 *
 * Detail lives at `/students?student=id` rather than `/students/:id` so that the
 * route registry above stays keyed by literal path - the heading, breadcrumb and
 * nav highlight all read from it.
 */
export const STUDENT_PARAM = "student";

export function studentDetailHref(studentId: string): string {
  return `/students?${STUDENT_PARAM}=${encodeURIComponent(studentId)}`;
}

export interface Crumb {
  text: string;
  href: string;
}

/**
 * @param rootText  Product name from the branding API, so the top crumb matches
 *                  whatever the deployment calls itself.
 * @param subCrumb  A leaf below the current page, e.g. the student id on the
 *                  detail view. Student detail lives at `/students?student=id` -
 *                  see STUDENT_PARAM.
 */
export function buildCrumbs(
  pathname: string,
  rootText: string,
  subCrumb?: Crumb | null,
): Crumb[] {
  const route = findRoute(pathname);
  // The product name is always the root crumb, and the page name always
  // follows it - including on the dashboard, so the trail's depth doesn't
  // change as you navigate. Its href follows the audience: on the student page
  // the root crumb must not be the admin dashboard.
  const crumbs: Crumb[] = [
    { text: rootText, href: homeHrefFor(audienceOf(route)) },
  ];
  // Ancestors first, so "Add student" is reached through "Students" and the
  // trail is a route back rather than a label. Walked as a list and reversed
  // rather than recursed, and bounded by ROUTES.length so a `parent` cycle
  // introduced by a later edit cannot hang the shell.
  const ancestors: Crumb[] = [];
  let parentHref = route.parent;
  for (let depth = 0; parentHref && depth < ROUTES.length; depth += 1) {
    const parent = ROUTES.find((r) => r.href === parentHref);
    if (!parent) break;
    ancestors.unshift({ text: parent.text, href: parent.href });
    parentHref = parent.parent;
  }
  crumbs.push(...ancestors, { text: route.text, href: route.href });
  if (subCrumb) crumbs.push(subCrumb);
  return crumbs;
}

/**
 * Which side-navigation item to highlight. A child route highlights its parent,
 * so opening "Add student" leaves "Students" selected instead of clearing the
 * selection and leaving the user with no idea where they are.
 */
export function activeNavHref(pathname: string): string {
  const route = findRoute(pathname);
  return route.showInNav === false && route.parent
    ? route.parent
    : route.href;
}

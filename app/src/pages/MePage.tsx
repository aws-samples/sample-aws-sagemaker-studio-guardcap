import StudentPortal from "@/components/me/StudentPortal";

/**
 * The student's own page: /me.
 *
 * A thin wrapper on purpose: the route table in main.tsx names a component per
 * path, and everything this page does lives in StudentPortal.
 */
export default function MePage() {
  return <StudentPortal />;
}

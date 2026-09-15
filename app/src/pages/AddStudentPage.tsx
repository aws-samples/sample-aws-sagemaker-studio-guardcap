import AddStudentForm from "@/components/students/AddStudentForm";

// A route of its own rather than a modal over the table, so the form has a URL:
// it survives a reload, and "Cancel" is a navigation rather than a dismissal. The
// heading, breadcrumbs and side-nav highlight all come from the route registry -
// see the /students/new entry in lib/nav.ts.
export default function AddStudentPage() {
  return <AddStudentForm />;
}

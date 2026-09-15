import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import type { ButtonDropdownProps } from "@cloudscape-design/components/button-dropdown";
import { availableActions, type StudentActionId } from "@/lib/actions";
import type { Student } from "@/lib/api/types";

/**
 * The per-row action menu.
 *
 * A dropdown rather than inline buttons: three of these four actions change or
 * destroy a live environment, and a row of bare buttons next to a table the admin
 * is scrolling is how the wrong student gets suspended. The extra click is the
 * point.
 */
export default function StudentRowActions({
  student,
  busy,
  onAction,
  /**
   * "row" is the icon-only trigger for a table cell. "header" is the labelled
   * button for a page header, where there is one student, room for a word, and no
   * neighbouring row to mis-click into.
   */
  variant = "row",
}: {
  student: Student;
  busy: boolean;
  onAction: (id: StudentActionId, student: Student) => void;
  variant?: "row" | "header";
}) {
  const items: ButtonDropdownProps.Items = availableActions(student).map(
    (action) => ({
      id: action.id,
      text: action.text,
      disabled: action.disabledReason !== undefined,
      // Cloudscape shows this on hover and reads it to screen readers, so the
      // reason travels with the disabled item instead of being lost.
      disabledReason: action.disabledReason,
      // Terminate is the only irreversible one, and it is last in the list -
      // exactly where a mis-aimed click lands. Marking it as destructive gives
      // it the red treatment before the confirmation dialog is ever reached.
      ...(action.id === "terminate" ? { iconName: "remove" as const } : {}),
    }),
  );

  return (
    <ButtonDropdown
      items={items}
      // Expanded on hover would fire on scroll; explicit click only.
      expandToViewport
      loading={busy}
      // Named per student, not just "Actions": with eight of these on a page the
      // accessible name is otherwise identical in every row.
      ariaLabel={`Actions for ${student.studentId}`}
      variant={variant === "header" ? "normal" : "inline-icon"}
      onItemClick={({ detail }) =>
        onAction(detail.id as StudentActionId, student)
      }
    >
      {/* Children are the trigger label, which the icon-only variant has no room
          for - Cloudscape ignores them there. */}
      Actions
    </ButtonDropdown>
  );
}

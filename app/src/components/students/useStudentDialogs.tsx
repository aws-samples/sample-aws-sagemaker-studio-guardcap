import { useState, type ReactNode } from "react";
import type { StudentActionId } from "@/lib/actions";
import type { Student } from "@/lib/api/types";
import { useStudentActions } from "@/lib/data/useStudentActions";
import BudgetModal from "./BudgetModal";
import SuspendModal from "./SuspendModal";
import TerminateModal from "./TerminateModal";

/**
 * The confirmation dialogs for the four per-student actions, and the state that
 * decides which one is open.
 *
 * A hook rather than a component because two views need the identical behaviour -
 * the table's row menu and the detail page's header menu - and the alternative was
 * two copies of the "which dialog is open, and does it close on failure" logic.
 * Two copies of a terminate confirmation is one copy too many.
 *
 * @param students the list the open dialog reads its figures from. Pass the fleet
 *   on the table, or a single-element array on the detail page.
 * @param onTerminated called after a termination is accepted. The detail page
 *   navigates away with it: the student it exists to show is on the way out.
 */
export function useStudentDialogs(
  students: Student[],
  { onTerminated }: { onTerminated?: (studentId: string) => void } = {},
): {
  onAction: (id: StudentActionId, student: Student) => void;
  busyFor: (studentId: string) => boolean;
  actions: ReturnType<typeof useStudentActions>;
  dialogs: ReactNode;
} {
  // One dialog at a time, and the state lives here rather than in the row so that
  // a 30-second refresh re-rendering the rows cannot close an open modal.
  const [pending, setPending] = useState<{
    action: Exclude<StudentActionId, "resume">;
    studentId: string;
  } | null>(null);
  const actions = useStudentActions();

  // Resolved from the current list, not captured at open time: the modals quote
  // spend and budget, and a figure frozen at the moment the menu was clicked
  // would be the one number on screen not refreshing. Falls to null if the
  // student disappears from the fleet mid-dialog, which closes it.
  const forAction = (action: StudentActionId): Student | null =>
    pending?.action === action
      ? (students.find((s) => s.studentId === pending.studentId) ?? null)
      : null;

  const busyFor = (studentId: string) => actions.busyId === studentId;
  const close = () => setPending(null);

  const onAction = (id: StudentActionId, student: Student) => {
    // Resume is the only one that goes straight through: it only ever restores
    // access, so there is nothing to confirm and nothing to undo.
    if (id === "resume") {
      void actions.resume(student);
      return;
    }
    setPending({ action: id, studentId: student.studentId });
  };

  // Each dialog closes on success and stays open on failure, so the flash naming
  // the reason is read next to the form that produced it rather than over an
  // empty table.
  const runFromDialog = async (promise: Promise<boolean>) => {
    if (await promise) close();
  };

  const dialogs = (
    <>
      {/*
        All three rendered unconditionally and self-closing on a null student, so
        the modal state is in one place rather than three conditional branches.
      */}
      <SuspendModal
        student={forAction("suspend")}
        submitting={actions.busyId !== null}
        onDismiss={close}
        onConfirm={(student) => void runFromDialog(actions.suspend(student))}
      />
      <BudgetModal
        student={forAction("edit-budget")}
        submitting={actions.busyId !== null}
        onDismiss={close}
        onSubmit={(student, amountUsd) =>
          void runFromDialog(actions.setBudget(student, amountUsd))
        }
      />
      <TerminateModal
        student={forAction("terminate")}
        submitting={actions.busyId !== null}
        onDismiss={close}
        onConfirm={(student) => {
          void actions.terminate(student).then((ok) => {
            if (!ok) return;
            close();
            onTerminated?.(student.studentId);
          });
        }}
      />
    </>
  );

  return { onAction, busyFor, actions, dialogs };
}

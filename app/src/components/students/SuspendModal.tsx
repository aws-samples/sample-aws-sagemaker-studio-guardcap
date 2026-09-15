import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import type { Student } from "@/lib/api/types";
import { studentName } from "@/lib/students";

/**
 * Confirmation for suspend.
 *
 * Suspend is reversible - Resume puts it back - but it stops the student's running
 * Studio apps, and anything they had not written to their home directory goes with
 * them. That is worth one click to acknowledge, and it is why this dialog says what
 * happens to the work rather than just "are you sure".
 *
 * Resume needs no dialog: it only ever grants access back, and there is nothing to
 * lose by clicking it on a student who is already able to work.
 */
export default function SuspendModal({
  student,
  submitting,
  onDismiss,
  onConfirm,
}: {
  /** Null when closed. */
  student: Student | null;
  submitting: boolean;
  onDismiss: () => void;
  onConfirm: (student: Student) => void;
}) {
  if (student === null) return null;

  return (
    <Modal
      visible
      onDismiss={onDismiss}
      header={`Suspend ${studentName(student)}?`}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            {/* nosemgrep: jsx-not-internationalized */}
            <Button variant="link" onClick={onDismiss} disabled={submitting}>
              Cancel
            </Button>
            {/* nosemgrep: jsx-not-internationalized */}
            <Button
              variant="primary"
              loading={submitting}
              onClick={() => onConfirm(student)}
              data-testid="suspend-submit"
            >
              Suspend
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="s">
        {/* nosemgrep: jsx-not-internationalized */}
        <Box>
          This stops any Studio app {studentName(student)} is running and blocks
          them from starting a new one. Work they have not saved to their home
          directory will be lost.
        </Box>
        {/* nosemgrep: jsx-not-internationalized */}
        <Box color="text-body-secondary">
          Their environment and budget stay in place, and Resume gives access back
          at any time.
        </Box>
      </SpaceBetween>
    </Modal>
  );
}

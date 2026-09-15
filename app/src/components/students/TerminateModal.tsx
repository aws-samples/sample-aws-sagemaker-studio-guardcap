import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { useState } from "react";
import type { Student } from "@/lib/api/types";
import { formatUsd, studentName, toNumber } from "@/lib/students";

/**
 * Confirmation for the one irreversible action.
 *
 * Typing the student id, not just clicking a red button. This tears down a real
 * CloudFormation stack - execution role, notebook profile, budget and every
 * enforcement resource - and there is no undo and no backup of it. A single click
 * on a row the admin had mis-identified is the failure this guards against, and
 * having to type "s-014" forces a second look at which student it is.
 *
 * The old console asked for a plain confirm here. Everything else about that
 * dialog is kept, including naming what is destroyed rather than saying "all
 * resources".
 */
export default function TerminateModal({
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
  const [typed, setTyped] = useState("");
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);

  // Reset during render for the same reason as the budget modal: an effect keyed
  // on the polled Student object would clear the field on every refresh.
  if (student !== null && confirmedFor !== student.studentId) {
    setConfirmedFor(student.studentId);
    setTyped("");
  }

  if (student === null) return null;

  // Trimmed, because a trailing space from a copy-paste out of the table is not a
  // different student. Case is NOT ignored: student ids are lowercase in every
  // AWS resource name derived from them, so an uppercase entry means the admin
  // typed it from memory rather than read it.
  const matches = typed.trim() === student.studentId;

  return (
    <Modal
      visible
      onDismiss={onDismiss}
      header={`Terminate ${studentName(student)}?`}
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
              // Cloudscape has no destructive button variant, so the wording
              // carries it: the button says what it does, not "Confirm".
              disabled={!matches}
              loading={submitting}
              onClick={() => onConfirm(student)}
              data-testid="terminate-submit"
            >
              Terminate environment
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {/* nosemgrep: jsx-not-internationalized */}
        <Alert type="warning" header="This cannot be undone">
          Terminating tears down this student&apos;s entire environment: their
          SageMaker execution role, notebook profile, budget and all enforcement
          resources. Their notebooks and any data held only on the instance are
          destroyed with it.
        </Alert>
        {/*
          The spend is quoted because it is the figure most likely to reveal a
          mis-identified row: an admin intending to remove an idle student who sees
          $412.90 here has picked the wrong one.

          Omitted entirely at zero, which is the most common terminate - clearing a
          failed provision. "Spend already incurred is not refunded" says nothing
          about $0.00, and a dialog that has to be read carefully should not pad
          itself with sentences that do not apply.
        */}
        {toNumber(student.currentSpendUsd) > 0 && ( // nosemgrep: jsx-not-internationalized
          <Box>
            Recorded spend so far is {formatUsd(student.currentSpendUsd)}. Spend
            already incurred is not refunded, and the record of it is removed
            along with the student.
          </Box>
        )}
        <FormField
          label={`To confirm, type ${student.studentId}`}
          description="This is deliberately awkward - it is the only action here that destroys resources."
        >
          <Input
            value={typed}
            onChange={({ detail }) => setTyped(detail.value)}
            onKeyDown={({ detail }) => {
              if (detail.key === "Enter" && matches) onConfirm(student);
            }}
            disabled={submitting}
            placeholder={student.studentId}
            // No autofocus: focus landing in the field of a destructive dialog
            // makes a stray keystroke part of the confirmation.
            data-testid="terminate-input"
          />
        </FormField>
      </SpaceBetween>
    </Modal>
  );
}

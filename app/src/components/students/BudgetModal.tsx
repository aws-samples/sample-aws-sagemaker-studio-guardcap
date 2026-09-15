import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { useState } from "react";
import { validateBudget } from "@/lib/actions";
import type { Student } from "@/lib/api/types";
import { formatPercent, formatUsd, percentUsed, studentName, toNumber } from "@/lib/students";

/**
 * Sets a student's budget to an absolute amount.
 *
 * The current spend and budget are shown next to the field on purpose: this dialog
 * is most often opened to release a student the budget alarm has held, and the
 * number that does that is "more than what they have already spent". Asking the
 * admin to remember it from the row behind the modal is how a budget gets set back
 * under current spend and the hold re-applies immediately.
 */
export default function BudgetModal({
  student,
  submitting,
  onDismiss,
  onSubmit,
}: {
  /** Null when closed. */
  student: Student | null;
  submitting: boolean;
  onDismiss: () => void;
  onSubmit: (student: Student, amountUsd: number) => void;
}) {
  const [input, setInput] = useState("");
  // Errors appear on submit, not while the admin is still typing: "Enter a
  // number" under a half-typed "1" is noise.
  const [showErrors, setShowErrors] = useState(false);
  // Whether the field has been edited since the dialog opened. The warning is a
  // statement about what saving would do, and a held student's CURRENT budget is
  // by definition below their spend - so shown on open it would fire on every
  // release, as a verdict on a value the admin had not chosen yet.
  const [dirty, setDirty] = useState(false);

  // Seeded during render rather than in an effect, so the field is populated on
  // the first frame instead of flashing empty. Keyed on the id, not the object:
  // the fleet is re-read every 30 seconds, so the Student identity changes
  // underneath an open modal and re-seeding on that would wipe what was typed.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (student !== null && seededFor !== student.studentId) {
    setSeededFor(student.studentId);
    setShowErrors(false);
    setDirty(false);
    setInput(
      student.perStudentBudgetUsd == null
        ? ""
        : String(toNumber(student.perStudentBudgetUsd)),
    );
  }

  if (student === null) return null;

  const spend = toNumber(student.currentSpendUsd);
  const validation = validateBudget(input, spend);

  const submit = () => {
    setShowErrors(true);
    // Saving an untouched value is still a save, so the caveat has to be visible
    // by the time it happens.
    setDirty(true);
    if (validation.value === null) return;
    onSubmit(student, validation.value);
  };

  return (
    <Modal
      visible
      onDismiss={onDismiss}
      header={`Edit budget for ${studentName(student)}`}
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
              onClick={submit}
              loading={submitting}
              data-testid="budget-submit"
            >
              Save budget
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form variant="embedded">
        <SpaceBetween size="l">
          <KeyValuePairs
            columns={2}
            items={[
              {
                label: "Current spend",
                value: formatUsd(student.currentSpendUsd),
              },
              {
                label: "Current budget",
                value: `${formatUsd(student.perStudentBudgetUsd)} (${formatPercent(
                  percentUsed(student),
                )} used)`,
              },
            ]}
          />
          <FormField
            label="New budget"
            // Absolute, not a delta: the API replaces the value, and the user
            // asked to "increase their budgets", which is the same call with a
            // bigger number. Saying so prevents "50" meaning "add 50".
            description="Replaces the current budget rather than adding to it."
            errorText={showErrors ? validation.error : null}
            constraintText="US dollars, greater than 0."
          >
            <Input
              value={input}
              // type="number" for the numeric keypad on touch and the browser's
              // own rejection of letters; the value is still validated here,
              // because a number input happily reports "" and "1e9".
              type="number"
              inputMode="decimal"
              onChange={({ detail }) => {
                setInput(detail.value);
                setDirty(true);
              }}
              onKeyDown={({ detail }) => {
                if (detail.key === "Enter") submit();
              }}
              disabled={submitting}
              data-testid="budget-input"
            />
          </FormField>
          {dirty && validation.warning !== null && (
            // A warning, not an error: setting a budget below current spend is
            // sometimes exactly what an admin means to do - it is how a student
            // is held without suspending them outright. So it is stated, not
            // blocked.
            <Alert type="warning" header="This will not release the student">
              {validation.warning}
            </Alert>
          )}
        </SpaceBetween>
      </Form>
    </Modal>
  );
}

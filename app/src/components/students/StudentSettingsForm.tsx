import Alert from "@cloudscape-design/components/alert";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { useState } from "react";
import { validateBudget } from "@/lib/actions";
import type { Student } from "@/lib/api/types";
import { isEmail } from "@/lib/newStudent";
import { toNumber } from "@/lib/students";

/**
 * Budget and notification email for one student, edited in place.
 *
 * Both fields go to the same PUT /students/{id}/budget, so they are one form with
 * one Save: two separate forms over one endpoint would let a save of either field
 * silently overwrite the other with whatever was on screen.
 */
export default function StudentSettingsForm({
  student,
  submitting,
  onSave,
}: {
  student: Student;
  submitting: boolean;
  onSave: (amountUsd: number, notificationEmail: string) => void;
}) {
  const [budget, setBudget] = useState("");
  const [email, setEmail] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Seeded during render and keyed on the id, not the object - the same reasoning
  // as BudgetModal: this page re-reads the student every 30 seconds, so seeding on
  // the Student identity would wipe half-typed input on each refresh.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (seededFor !== student.studentId) {
    setSeededFor(student.studentId);
    setShowErrors(false);
    setDirty(false);
    setBudget(
      student.perStudentBudgetUsd == null
        ? ""
        : String(toNumber(student.perStudentBudgetUsd)),
    );
    setEmail(student.notificationEmail ?? "");
  }

  const budgetValidation = validateBudget(budget, toNumber(student.currentSpendUsd));
  // Optional: blank means the backend falls back to the ops address, which is a
  // legitimate choice and not an incomplete form.
  const emailError =
    email.trim() !== "" && !isEmail(email)
      ? "Enter a valid email address, or leave it blank."
      : null;

  const submit = () => {
    setShowErrors(true);
    setDirty(true);
    if (budgetValidation.value === null || emailError !== null) return;
    onSave(budgetValidation.value, email.trim());
  };

  return (
    <Container
      header={
        // nosemgrep: jsx-not-internationalized
        <Header
          variant="h2"
          description="Applies to this student only. Saving sends both fields together."
        >
          Settings
        </Header>
      }
    >
      <Form
        variant="embedded"
        actions={
          // nosemgrep: jsx-not-internationalized
          <Button
            variant="primary"
            onClick={submit}
            loading={submitting}
            data-testid="settings-save"
          >
            Save changes
          </Button>
        }
      >
        <SpaceBetween size="l">
          <FormField
            label="Budget"
            description="Replaces the current budget rather than adding to it."
            constraintText="US dollars, greater than 0."
            errorText={showErrors ? budgetValidation.error : null}
          >
            <Input
              value={budget}
              type="number"
              inputMode="decimal"
              disabled={submitting}
              onChange={({ detail }) => {
                setBudget(detail.value);
                setDirty(true);
              }}
              data-testid="settings-budget"
            />
          </FormField>
          <FormField
            label="Notification email"
            // The old console's caveat, kept verbatim in substance because it is
            // the one non-obvious thing about this field: the AWS Budget's own
            // subscriber was set at creation time and this does not touch it.
            description="Optional. Updates this console's record only - it does not change the email subscriber already configured on the student's AWS Budget at creation time."
            errorText={showErrors ? emailError : null}
          >
            <Input
              value={email}
              type="email"
              inputMode="email"
              placeholder="Leave blank to use the platform's ops address"
              disabled={submitting}
              onChange={({ detail }) => {
                setEmail(detail.value);
                setDirty(true);
              }}
              data-testid="settings-email"
            />
          </FormField>
          {dirty && budgetValidation.warning !== null && (
            // Stated, not blocked - the same rule as BudgetModal. Setting a budget
            // under current spend is how a student is held without suspending them.
            <Alert type="warning" header="This will not release the student">
              {budgetValidation.warning}
            </Alert>
          )}
        </SpaceBetween>
      </Form>
    </Container>
  );
}

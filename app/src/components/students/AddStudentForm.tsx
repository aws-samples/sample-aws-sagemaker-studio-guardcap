import Alert from "@cloudscape-design/components/alert";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { useRouter } from "@/lib/router";
import { useState } from "react";
import PageLayout from "@/components/shell/PageLayout";
import { useCreateStudent } from "@/lib/data/useCreateStudent";
import { useFleet } from "@/lib/data/useFleet";
import {
  EMPTY_DRAFT,
  INSTANCE_TYPES,
  type NewStudentDraft,
  validateNewStudent,
} from "@/lib/newStudent";

const INSTANCE_OPTIONS = INSTANCE_TYPES.map((option) => ({
  value: option.value,
  label: option.label,
  description: option.description,
  labelTag: option.labelTag,
}));

/**
 * Provisions one student.
 *
 * A full page rather than the old console's modal, following the Venue design: the
 * form asks for six things and creates real, billable AWS resources, which is more
 * than a dialog over a table should be doing. The extra room also lets each field
 * carry the note that explains it.
 */
export default function AddStudentForm() {
  const router = useRouter();
  const { students } = useFleet();
  const { creating, create } = useCreateStudent();

  const [draft, setDraft] = useState<NewStudentDraft>(EMPTY_DRAFT);
  // Errors appear on submit, not per keystroke: "Enter a student ID" under an
  // empty field the admin has not reached yet is noise.
  const [showValidation, setShowValidation] = useState(false);

  const set = <K extends keyof NewStudentDraft>(
    key: K,
    value: NewStudentDraft[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  // The fleet is read purely to reject an id that already exists. It comes from
  // the shared cache, so this costs no request of its own.
  const { errors, payload } = validateNewStudent(
    draft,
    students.map((s) => s.studentId),
  );
  const errorFor = (key: keyof NewStudentDraft) =>
    showValidation ? (errors[key] ?? null) : null;

  const cancel = () => router.push("/students");

  const submit = () => {
    setShowValidation(true);
    if (payload === null) return;
    void create(payload).then((ok) => {
      // Only navigates on success. A failure leaves the filled-in form under the
      // flash explaining why, so the admin can fix one field rather than retype
      // six.
      if (ok) router.push("/students");
    });
  };

  const selectedInstance =
    INSTANCE_OPTIONS.find((option) => option.value === draft.instanceType) ??
    null;

  return (
    <PageLayout>
      <form
        onSubmit={(event) => {
          // Here for the Enter key inside a text field, which submits the native
          // form. NOT for the Add student button - that one carries formAction="none"
          // precisely so it does not reach this handler as well. See the comment on
          // the button.
          event.preventDefault();
          submit();
        }}
      >
        <Form
          variant="full-page"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              {/* nosemgrep: jsx-not-internationalized */}
              {/* Same reason, and worse here: without it, Cancel would navigate away
                  AND submit the form, creating the student it was meant to abandon. */}
              <Button
                variant="link"
                formAction="none"
                onClick={cancel}
                disabled={creating}
              >
                Cancel
              </Button>
              {/* nosemgrep: jsx-not-internationalized */}
              {/* formAction="none" is load-bearing, not tidying. Cloudscape Button
                  defaults to formAction="submit", so inside this <form> a single
                  click ran onClick AND submitted the form - two POST /students in
                  the same millisecond. The first returned 202 and created the
                  student; the second lost the backend's conditional claim and
                  returned 409, and the flash rendered the loser: "Student <id>
                  already exists" on every single successful add. loading={creating}
                  does not help, because both handlers run before React re-renders
                  with creating=true. Observed 2026-08-26 in the API access log. */}
              <Button
                variant="primary"
                formAction="none"
                onClick={submit}
                loading={creating}
                data-testid="create-student"
              >
                Add student
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Alert type="info" header="What this does">
              {/*
                The old console's info box, kept: one POST here creates an identity,
                a group membership, a budget, enforcement resources and a notebook
                stack. An admin who does not know that cannot judge what to do when
                it half-fails.
              */}
              Creating a student also creates an IAM Identity Center identity if
              they do not already have one, adds them to the student group, and
              provisions their notebook environment. The student is not emailed
              automatically - send them their sign-in details separately.
            </Alert>

            {/* nosemgrep: jsx-not-internationalized */}
            <Container header={<Header variant="h2">Student identity</Header>}>
              <SpaceBetween size="l">
                <FormField
                  label="Student ID"
                  description="Becomes their IAM Identity Center username and the suffix of every AWS resource created for them. It cannot be changed later."
                  constraintText="3 to 63 letters, digits, dots, underscores or hyphens. No spaces."
                  errorText={errorFor("studentId")}
                >
                  <Input
                    value={draft.studentId}
                    disabled={creating}
                    onChange={({ detail }) => set("studentId", detail.value)}
                    data-testid="new-student-id"
                  />
                </FormField>
                {/*
                  No "existing domain ID" field, though the Venue design has one:
                  POST /students does not accept a domain id. The backend takes the
                  Studio domain from the platform stack, so asking for it would be a
                  question with no effect on the result.
                */}
                <ColumnLayout columns={2}>
                  <FormField
                    label="Given name"
                    errorText={errorFor("givenName")}
                  >
                    <Input
                      value={draft.givenName}
                      disabled={creating}
                      onChange={({ detail }) => set("givenName", detail.value)}
                      data-testid="new-given-name"
                    />
                  </FormField>
                  <FormField
                    label="Family name"
                    errorText={errorFor("familyName")}
                  >
                    <Input
                      value={draft.familyName}
                      disabled={creating}
                      onChange={({ detail }) => set("familyName", detail.value)}
                      data-testid="new-family-name"
                    />
                  </FormField>
                </ColumnLayout>
                <FormField
                  label="Student email"
                  description="The address on their Identity Center identity."
                  errorText={errorFor("studentEmail")}
                >
                  <Input
                    value={draft.studentEmail}
                    type="email"
                    inputMode="email"
                    disabled={creating}
                    onChange={({ detail }) => set("studentEmail", detail.value)}
                    data-testid="new-student-email"
                  />
                </FormField>
              </SpaceBetween>
            </Container>

            <Container
              // nosemgrep: jsx-not-internationalized
              header={<Header variant="h2">Compute configuration</Header>}
            >
              <FormField
                label="Instance type"
                description="The notebook instance this student's environment runs on. GPU types cost several times more per hour than the CPU type."
                errorText={errorFor("instanceType")}
              >
                <Select
                  selectedOption={selectedInstance}
                  options={INSTANCE_OPTIONS}
                  // Typing to filter, because the values are long and nearly
                  // identical apart from the family.
                  filteringType="auto"
                  disabled={creating}
                  onChange={({ detail }) =>
                    set("instanceType", detail.selectedOption.value ?? "")
                  }
                  data-testid="new-instance-type"
                />
              </FormField>
            </Container>

            <Container
              // nosemgrep: jsx-not-internationalized
              header={<Header variant="h2">Budget and notifications</Header>}
            >
              <SpaceBetween size="l">
                <FormField
                  label="Budget"
                  description="When spend reaches this amount the student is put on hold automatically and cannot start new notebooks."
                  constraintText="US dollars, greater than 0."
                  errorText={errorFor("budgetUsd")}
                >
                  <Input
                    value={draft.budgetUsd}
                    type="number"
                    inputMode="decimal"
                    disabled={creating}
                    onChange={({ detail }) => set("budgetUsd", detail.value)}
                    data-testid="new-budget"
                  />
                </FormField>
                <FormField
                  label="Notification email - optional"
                  description="Where budget alerts for this student are sent. Leave blank to use the platform's ops address."
                  errorText={errorFor("notificationEmail")}
                >
                  <Input
                    value={draft.notificationEmail}
                    type="email"
                    inputMode="email"
                    disabled={creating}
                    onChange={({ detail }) =>
                      set("notificationEmail", detail.value)
                    }
                    data-testid="new-notification-email"
                  />
                </FormField>
              </SpaceBetween>
            </Container>
          </SpaceBetween>
        </Form>
      </form>
    </PageLayout>
  );
}

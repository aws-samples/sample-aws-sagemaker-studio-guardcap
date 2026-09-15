// Rules for provisioning a new student. Pure, for the same reason as actions.ts:
// this decides what gets sent to an endpoint that creates an Identity Center
// identity and launches a CloudFormation stack, and getting the id wrong means a
// half-built stack an admin then has to tear down.

import type { NewStudentInput } from "./api/types";

export interface InstanceTypeOption {
  value: string;
  label: string;
  description: string;
  /** Cloudscape renders this as a badge next to the label. */
  labelTag: "CPU" | "GPU";
}

/**
 * The provisioning template's own AllowedValues for InstanceType.
 *
 * Kept in sync by hand, because the template is never read at runtime - and it is
 * the template that rejects anything else, so a value missing from this list is
 * simply unavailable while a value not in the template is a failed stack.
 *
 * This is the list the working console shipped. The Venue design offers a
 * different set (ml.t3.large, ml.m5.xlarge, ml.g4dn.2xlarge, ml.p3.2xlarge) which
 * the template does not accept; those would all fail at provision time, so the
 * design's list is deliberately not used.
 */
export const INSTANCE_TYPES: readonly InstanceTypeOption[] = [
  {
    value: "ml.t3.medium",
    label: "ml.t3.medium",
    description: "2 vCPU, 4 GiB - no GPU. The cheapest option, for coursework that does not train models.",
    labelTag: "CPU",
  },
  {
    value: "ml.g4dn.xlarge",
    label: "ml.g4dn.xlarge",
    description: "4 vCPU, 16 GiB, 1x T4 GPU (16 GiB VRAM).",
    labelTag: "GPU",
  },
  {
    value: "ml.g5.xlarge",
    label: "ml.g5.xlarge",
    description: "4 vCPU, 16 GiB, 1x A10G GPU (24 GiB VRAM).",
    labelTag: "GPU",
  },
  {
    value: "ml.g6.xlarge",
    label: "ml.g6.xlarge",
    description: "4 vCPU, 16 GiB, 1x L4 GPU (24 GiB VRAM).",
    labelTag: "GPU",
  },
];

/** The cheapest option leads, so an unconsidered default is the safe one. */
export const DEFAULT_INSTANCE_TYPE = INSTANCE_TYPES[0].value;

/** What the old console defaulted to. Retained so the same fleet stays uniform. */
export const DEFAULT_BUDGET_USD = "80";

/**
 * The id becomes the student's Identity Center username and the suffix of every
 * AWS resource name derived from them, so its character set is not a matter of
 * taste. Matches the pattern the old console enforced.
 */
const STUDENT_ID_PATTERN = /^[a-zA-Z0-9._-]{3,63}$/;

/** Deliberately permissive: one @, no spaces. Real validation is the delivery. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Exported so the detail page's settings form applies the same rule as the create
 * form. Two different notions of a valid address would let an address through one
 * screen that the other rejects.
 */
export function isEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

/** Raw field values, exactly as typed. */
export interface NewStudentDraft {
  studentId: string;
  givenName: string;
  familyName: string;
  studentEmail: string;
  instanceType: string;
  budgetUsd: string;
  notificationEmail: string;
}

export const EMPTY_DRAFT: NewStudentDraft = {
  studentId: "",
  givenName: "",
  familyName: "",
  studentEmail: "",
  instanceType: DEFAULT_INSTANCE_TYPE,
  budgetUsd: DEFAULT_BUDGET_USD,
  notificationEmail: "",
};

/** One message per field, keyed by field name; absent means valid. */
export type NewStudentErrors = Partial<Record<keyof NewStudentDraft, string>>;

export interface NewStudentValidation {
  errors: NewStudentErrors;
  /** The payload to send, or null when any field is invalid. */
  payload: NewStudentInput | null;
}

/**
 * @param existingIds ids already in the fleet. Checked here rather than left to
 *   the API: POST with a duplicate id would either fail after the admin had
 *   filled the whole form, or - worse, and unknowable from outside - collide with
 *   a live student's resources.
 */
export function validateNewStudent(
  draft: NewStudentDraft,
  existingIds: readonly string[] = [],
): NewStudentValidation {
  const errors: NewStudentErrors = {};

  const studentId = draft.studentId.trim();
  if (studentId === "") {
    errors.studentId = "Enter a student ID.";
  } else if (!STUDENT_ID_PATTERN.test(studentId)) {
    errors.studentId =
      "Use 3 to 63 letters, digits, dots, underscores or hyphens. No spaces.";
  } else if (existingIds.includes(studentId)) {
    errors.studentId = `${studentId} already exists. Open that student instead of creating a second one.`;
  }

  const givenName = draft.givenName.trim();
  if (givenName === "") errors.givenName = "Enter a given name.";

  const familyName = draft.familyName.trim();
  if (familyName === "") errors.familyName = "Enter a family name.";

  const studentEmail = draft.studentEmail.trim();
  if (studentEmail === "") {
    errors.studentEmail = "Enter the student's email address.";
  } else if (!EMAIL_PATTERN.test(studentEmail)) {
    errors.studentEmail = "Enter a valid email address.";
  }

  if (!INSTANCE_TYPES.some((option) => option.value === draft.instanceType)) {
    errors.instanceType = "Choose an instance type.";
  }

  const budgetUsd = Number(draft.budgetUsd.trim());
  if (draft.budgetUsd.trim() === "") {
    errors.budgetUsd = "Enter a budget.";
  } else if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
    errors.budgetUsd = "Enter an amount greater than 0.";
  }

  // Optional, so blank is fine - but a typo in it is not, since the address is
  // where every budget alert for this student will be sent.
  const notificationEmail = draft.notificationEmail.trim();
  if (notificationEmail !== "" && !EMAIL_PATTERN.test(notificationEmail)) {
    errors.notificationEmail = "Enter a valid email address, or leave it blank.";
  }

  if (Object.keys(errors).length > 0) return { errors, payload: null };

  return {
    errors,
    payload: {
      // Trimmed values, not the raw draft: a trailing space in an id would
      // become part of an IAM Identity Center username.
      studentId,
      givenName,
      familyName,
      studentEmail,
      instanceType: draft.instanceType,
      perStudentBudgetUsd: budgetUsd,
      ...(notificationEmail === "" ? {} : { notificationEmail }),
    },
  };
}

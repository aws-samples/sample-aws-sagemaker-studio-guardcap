import Box from "@cloudscape-design/components/box";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";

/**
 * An ARN, with a copy button.
 *
 * Copyable because an ARN's only real use is being pasted somewhere else - a CLI
 * command, a policy, a support case - and a 90-character string selected by hand
 * off a wrapped line is a string that gets truncated silently.
 *
 * Renders the VALUE half of a KeyValuePairs row only. KeyValuePairs draws the
 * label itself, so a label here would appear twice.
 */
export default function ArnValue({
  label,
  value,
}: {
  /** Named in the copy button's accessible label and confirmation text. */
  label: string;
  value: string | null | undefined;
}) {
  // An em dash rather than an empty cell: "not reported" is information, and a
  // blank space next to a label reads as a rendering fault.
  if (!value) return <>—</>;

  return (
    <CopyToClipboard
      variant="inline"
      textToCopy={value}
      copyButtonAriaLabel={`Copy ${label}`}
      copySuccessText={`${label} copied`}
      copyErrorText={`${label} failed to copy`}
      // variant="code" for the monospace treatment, because these are read
      // character by character when they are read at all - the account number and
      // the suffix are what distinguish two otherwise identical ARNs. It has to be
      // the variant and not a fontFamily prop: Box has no such prop, and passing
      // one is silently dropped (as it was in the old console).
      textToDisplay={
        <Box variant="code" fontSize="body-s" display="inline">
          {value}
        </Box>
      }
    />
  );
}

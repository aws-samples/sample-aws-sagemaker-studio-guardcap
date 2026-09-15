// Line-art figure for the sign-in page's left column. Every stroke is
// currentColor so it inherits Cloudscape's text colour and stays visible in
// dark mode - a hardcoded stroke would disappear against a dark background.
// aria-hidden because it carries no information the adjacent copy doesn't.
export default function SignInIllustration() {
  return (
    <svg
      viewBox="0 0 240 150"
      width="100%"
      style={{ maxWidth: 340, height: "auto", color: "inherit" }}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* Three stacked notebook instances */}
      <rect x="26" y="24" width="72" height="30" rx="3" />
      <circle cx="38" cy="39" r="3.5" />
      <path d="M50 39h34" />

      <rect x="26" y="62" width="72" height="30" rx="3" />
      <circle cx="38" cy="77" r="3.5" />
      <path d="M50 77h34" />

      <rect x="26" y="100" width="72" height="30" rx="3" />
      <circle cx="38" cy="115" r="3.5" />
      <path d="M50 115h24" />

      {/* Connectors out to a shared GPU pool */}
      <path d="M98 39h24v38h-24M98 77h24M98 115h24V77" />

      {/* GPU / accelerator block */}
      <rect x="146" y="52" width="66" height="50" rx="4" />
      <path d="M158 66h42M158 77h42M158 88h28" />
      <path d="M212 62h10M212 77h10M212 92h10" />

      {/* Budget gauge underneath */}
      <path d="M146 122h66" strokeWidth="4" strokeOpacity="0.25" />
      <path d="M146 122h40" strokeWidth="4" />
    </svg>
  );
}

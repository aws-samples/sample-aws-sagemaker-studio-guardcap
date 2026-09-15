import { useTheme } from "@/components/theme/ThemeProvider";
import {
  AWS_LOGO_DARK,
  AWS_LOGO_WHITE,
  useConfig,
} from "./BootstrapProvider";

interface BrandLogoProps {
  /** Rendered height in px. The image keeps its own aspect ratio. */
  height?: number;
}

/**
 * Falls back to the AWS mark when the deployment supplies no logo, or supplies
 * one the browser will not render - see useRenderableImage in BootstrapProvider,
 * which reports the second case as the first. This is the platform's own product
 * mark, so it is a correct thing to show rather than a placeholder.
 *
 * The variant follows the color mode, because this one is rendered on the page
 * body rather than on the top navigation bar: a white mark on the light theme
 * would be an invisible logo, which looks the same as no logo at all.
 * A plain <img> with no framework wrapper, which is all this can be: the URL is
 * arbitrary API-supplied data, so it cannot be resolved or optimized at build
 * time.
 */
export default function BrandLogo({ height = 40 }: BrandLogoProps) {
  const { config } = useConfig();
  const { resolved } = useTheme();

  const branded = config.logoUrl !== "";
  const src = branded
    ? config.logoUrl
    : resolved === "dark"
      ? AWS_LOGO_WHITE
      : AWS_LOGO_DARK;

  return (
    <img
      src={src}
      // The institution's own title still names an unbranded deployment. The alt
      // text describes what the page is, not which file happened to load.
      alt={config.appTitle}
      height={height}
      style={{ height, width: "auto", display: "block" }}
      data-testid={branded ? "brand-logo" : "brand-fallback-logo"}
    />
  );
}

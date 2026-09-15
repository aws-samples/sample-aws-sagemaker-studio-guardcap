import { applyTheme } from "@cloudscape-design/components/theming";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_INIT, fetchInit } from "@/lib/api/init";
import type { InitConfig } from "@/lib/api/types";
import { configureAuth } from "@/lib/auth/cognito";

interface BootstrapContextValue {
  config: InitConfig;
  /**
   * False until the /init request has settled, either way. Sign-in must wait for
   * it: the hosted UI domain and client id come from that response, so
   * redirecting earlier would send the browser to the wrong place - or to
   * nowhere, on a deployment with no build-time env vars to fall back on.
   */
  isReady: boolean;
}

const BootstrapContext = createContext<BootstrapContextValue>({
  config: DEFAULT_INIT,
  isReady: false,
});

/** Branding, identity mode and support contact, as served by GET /init. */
export function useConfig(): BootstrapContextValue {
  return useContext(BootstrapContext);
}

const FAVICON_MIME: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
};

function faviconType(url: string): string | undefined {
  return FAVICON_MIME[url.split("?")[0].split(".").pop()?.toLowerCase() ?? ""];
}

/**
 * The AWS mark, served from this app's own origin, in the two contrasts the
 * chrome needs: white for the top navigation bar, which is dark under either
 * color mode, and dark for the sign-in page, which is not.
 *
 * Local files rather than the a0.awsstatic.com URL the backend defaults to, for
 * exactly the reason the branded logo needed a fallback in the first place: an
 * asset on someone else's origin can stop being embeddable without warning, and
 * the one image whose job is to render when nothing else does should not depend
 * on a third party. Same origin also means no second connection to set up before
 * the first paint.
 */
export const AWS_LOGO_WHITE = "/brand/aws-logo-white.svg";
export const AWS_LOGO_DARK = "/brand/aws-logo-dark.svg";

/**
 * An image URL, or the fallback once the browser has refused to render it.
 *
 * /init may point the logo and favicon at any host, and a host is entitled to
 * refuse being embedded elsewhere. Some university sites serve their logo with
 * `Cross-Origin-Resource-Policy: same-site`, which the browser enforces on every
 * no-cors subresource load - so the <img> fails whatever attributes it carries.
 * There is no `referrerpolicy` or `crossorigin` value that overrides it, because
 * the refusal is the point of the header; the fix is to serve the file from this
 * app's own origin.
 *
 * Until someone does, this at least keeps a broken-image icon out of the top
 * bar. Loaded through an Image rather than probed with fetch: a CORP failure and
 * a 404 both surface as `error` here, and fetch would need CORS the branding
 * hosts have no reason to grant.
 */
function useRenderableImage(url: string, fallback: string): string {
  // The URL, not a boolean: a config change has to re-probe, and keying the
  // state by URL means a stale result cannot outlive the URL it was about.
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    const probe = new Image();
    probe.onerror = () => setFailed(url);
    probe.src = url;
    return () => {
      // The load continues, but its result no longer lands anywhere.
      probe.onerror = null;
    };
  }, [url]);

  return failed === url ? fallback : url;
}

/**
 * Fetched once per page load, outside React.
 *
 * Not SWR, unlike every other read in this app, and not by omission: this
 * response is cached for five minutes by the API and is configuration rather
 * than data, so there is nothing to poll for. The promise is memoized at module
 * scope so React's double-invoked development effect issues one request, and so
 * that `configureAuth` runs exactly once before anything can read it.
 */
let initPromise: Promise<InitConfig> | null = null;

function loadInit(): Promise<InitConfig> {
  initPromise ??= fetchInit().then((config) => {
    configureAuth(config);
    return config;
  });
  return initPromise;
}

/**
 * Applies the deployment's accent colour to Cloudscape's primary tokens.
 *
 * Only the accent: deriving a whole palette from one hex would produce
 * contrast Cloudscape has not checked, and a console that is hard to read is a
 * worse outcome than one that is insufficiently branded. Hover and active are
 * darkened mechanically so the button still responds to the pointer.
 */
function applyAccent(primaryColor: string): (() => void) | undefined {
  if (primaryColor === DEFAULT_INIT.primaryColor) return undefined;
  const { reset } = applyTheme({
    theme: {
      tokens: {
        colorBackgroundButtonPrimaryDefault: primaryColor,
        colorBackgroundButtonPrimaryHover: shade(primaryColor, 0.85),
        colorBackgroundButtonPrimaryActive: shade(primaryColor, 0.7),
        colorTextAccent: primaryColor,
        colorTextLinkDefault: primaryColor,
      },
    },
  });
  return reset;
}

/** Multiplies each channel, so 0.85 is "15% darker". Non-hex input is returned as-is. */
function shade(hex: string, factor: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return hex;
  const value = Number.parseInt(match[1], 16);
  const channel = (shift: number) =>
    Math.round(((value >> shift) & 0xff) * factor)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/**
 * Runtime configuration for the whole app: GET /init, fetched anonymously before
 * sign-in.
 *
 * This is what removes the build-time coupling to a deployment. Title, favicon,
 * logo, accent colour, institution name and the Cognito coordinates all arrive
 * here, so one exported bundle serves any stack and rebranding is a stack
 * parameter rather than a rebuild.
 */
export function BootstrapProvider({ children }: { children: ReactNode }) {
  // Starts at the defaults so the first frame renders complete chrome rather
  // than empty boxes, and so a prerendered page has something to show.
  const [config, setConfig] = useState<InitConfig>(DEFAULT_INIT);
  const [isReady, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    void loadInit().then((loaded) => {
      if (!live) return;
      setConfig(loaded);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => applyAccent(config.primaryColor), [config.primaryColor]);

  // Empty string for a logo that will not render, which is the same signal as
  // "this deployment supplied no logo" - so each consumer substitutes the AWS
  // mark in the contrast its own background calls for, rather than this provider
  // guessing one for both. The favicon falls back to the unbranded default
  // instead: dropping the <link> entirely would send the browser after a
  // /favicon.ico this export does not contain.
  const logoUrl = useRenderableImage(config.logoUrl, "");
  const faviconUrl = useRenderableImage(
    config.faviconUrl,
    DEFAULT_INIT.faviconUrl,
  );

  const value = useMemo(
    () => ({ config: { ...config, logoUrl }, isReady }),
    [config, logoUrl, isReady],
  );

  return (
    <BootstrapContext.Provider value={value}>
      {/* Rendered, not imperatively assigned. Next's own `metadata` title and
          icon are deliberately absent from layout.tsx: its client-side metadata
          pass runs after effects, so a document.title write during hydration
          got reverted and its <link rel="icon"> was re-appended alongside ours.
          React hoists these two into <head> - during prerender with the
          defaults, then swapped on re-render when the API answers - which
          leaves exactly one owner and no ordering race. */}
      <title>{config.appTitle}</title>
      <link rel="icon" href={faviconUrl} type={faviconType(faviconUrl)} />
      {children}
    </BootstrapContext.Provider>
  );
}

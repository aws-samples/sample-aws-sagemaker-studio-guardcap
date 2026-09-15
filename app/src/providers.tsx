import { I18nProvider } from "@cloudscape-design/components/i18n";
import enMessages from "@cloudscape-design/components/i18n/messages/all.en";
import type { ReactNode } from "react";
import AudienceGate from "@/components/auth/AudienceGate";
import { AuthProvider } from "@/components/auth/AuthProvider";
import RequireAuth from "@/components/auth/RequireAuth";
import { BootstrapProvider } from "@/components/branding/BootstrapProvider";
import NotificationProvider from "@/components/notifications/NotificationProvider";
import AppShell from "@/components/shell/AppShell";
import { ThemeProvider } from "@/components/theme/ThemeProvider";

// Single place for every client-side context. Order matters: BootstrapProvider
// sits inside ThemeProvider because the sign-in screen renders branding and
// needs the color mode already resolved, and AuthProvider sits inside both
// because the screen it gates is themed and branded - and because the Cognito
// coordinates it signs in with come from GET /init, which BootstrapProvider
// fetches anonymously and so does not depend on auth.
//
// AudienceGate sits inside RequireAuth and outside AppShell: it needs a token to
// ask GET /whoami, and the "no access to this platform" answer should not be
// framed by navigation into a console the account cannot use.
//
// RequireAuth and AppShell live here rather than in each page because every
// route in this console is authenticated and shares the same chrome. Putting
// them in the root layout also means they survive navigation instead of
// remounting - which matters for the in-memory session, and for the nav drawer
// staying where the user left it.
//
// I18nProvider is outermost, and it is here for accessibility rather than for
// translation. Cloudscape ships no default strings for the controls it renders
// internally, so without this the pagination arrows in AlarmEventsTable, the
// column resize handles, the modal close buttons and the Flashbar dismiss
// buttons all reach a screen reader with no accessible name at all. Supplying
// the English bundle names every one of them in a single place, which is why
// this is preferable to threading ariaLabels through each component by hand.
//
// The app is English-only and there is no plan to change that; if that ever
// changes, this is already the seam to change it at - swap the bundle and pass
// a different locale. Only the "en" messages are imported, not "all.all", which
// is 720 kB of locales nothing would read.
export default function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nProvider locale="en" messages={[enMessages]}>
      <ThemeProvider>
        <BootstrapProvider>
          <AuthProvider>
            <RequireAuth>
              <AudienceGate>
                {/*
                  Outside AppShell, because AppShell renders the Flashbar into
                  AppLayout's notifications slot and so has to be able to read
                  the context. Inside RequireAuth, because the only things
                  raising a notification are the signed-in actions.
                */}
                <NotificationProvider>
                  <AppShell>{children}</AppShell>
                </NotificationProvider>
              </AudienceGate>
            </RequireAuth>
          </AuthProvider>
        </BootstrapProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

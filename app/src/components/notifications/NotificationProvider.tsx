import Flashbar from "@cloudscape-design/components/flashbar";
import type { FlashbarProps } from "@cloudscape-design/components/flashbar";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * The one place an action's outcome is reported.
 *
 * A flash rather than an alert inside the table, because a suspend takes a few
 * seconds and the admin may well have navigated by the time it lands. The
 * Flashbar lives in AppLayout's notifications slot, so it is visible from every
 * page and survives the transition.
 */
export interface Notification {
  type: "success" | "error" | "info" | "warning";
  header: string;
  content?: ReactNode;
}

interface NotificationContextValue {
  notify: (notification: Notification) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error("useNotifications must be used inside NotificationProvider");
  }
  return ctx;
}

/** Successes clear themselves; failures stay until dismissed. */
const AUTO_DISMISS_MS = 6000;

export default function NotificationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [items, setItems] = useState<FlashbarProps.MessageDefinition[]>([]);
  // A counter, not Date.now() or a random value: two flashes raised in the same
  // millisecond would collide on a timestamp key, and React would drop one.
  const nextId = useRef(0);

  const notify = useCallback(({ type, header, content }: Notification) => {
    const id = `flash-${nextId.current++}`;
    const dismiss = () =>
      setItems((current) => current.filter((item) => item.id !== id));

    // Prepended, not appended. With `stackItems` the Flashbar expands items[0]
    // and collapses the rest behind a counter, so appending would leave the
    // OLDEST message on screen and hide the one the admin just caused - the
    // failure reason for the action they are watching, tucked behind a stale
    // success. Newest first is what a stacked flashbar means.
    setItems((current) => [
      {
        id,
        type,
        header,
        content,
        dismissible: true,
        onDismiss: dismiss,
        // Announced to screen readers. A flash is the only report that an action
        // worked or failed, so it has to reach someone not watching that corner
        // of the page: "alert" interrupts for failures, "status" waits for a
        // pause for successes.
        ariaRole: type === "error" || type === "warning" ? "alert" : "status",
      },
      ...current,
    ]);

    // Only successes expire. An error that vanished on its own would leave the
    // admin believing an action they were told nothing more about had worked.
    if (type === "success") {
      setTimeout(dismiss, AUTO_DISMISS_MS);
    }
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <NotificationContext.Provider value={value}>
      {/*
        The bar is rendered here alongside the provider so that AppShell can pull
        it straight into AppLayout's notifications slot without knowing how the
        list is kept.
      */}
      <NotificationBarContext.Provider value={items}>
        {children}
      </NotificationBarContext.Provider>
    </NotificationContext.Provider>
  );
}

const NotificationBarContext = createContext<
  FlashbarProps.MessageDefinition[]
>([]);

/**
 * Renders the current flashes. Separate from the provider so it can be placed in
 * AppLayout's notifications slot, which is a sibling of the content tree rather
 * than inside it.
 */
export function NotificationBar() {
  const items = useContext(NotificationBarContext);
  if (items.length === 0) return null;
  return <Flashbar items={items} stackItems />;
}

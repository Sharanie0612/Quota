import { useCallback, useEffect, useRef, useState } from "react";
import { errText, events } from "./api";

interface QueryOptions {
  enabled?: boolean;
  pollMs?: number;
  accounts?: boolean;
  onWindowFocus?: boolean;
}

/** Read a snapshot for the visible query. Collection and writes stay explicit user/backend actions. */
export function useReportQuery<T>(key: string, read: () => Promise<T>, options: QueryOptions = {}) {
  const { enabled = true, pollMs, accounts = false, onWindowFocus = false } = options;
  const [snapshot, setSnapshot] = useState<{ key: string; value: T } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const tail = useRef<Promise<void> | null>(null);
  const trigger = useRef<() => void>(() => {});
  const reload = useCallback(() => trigger.current(), []);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let scheduled = false;
    let timer: number | undefined;
    const visible = () => !disposed && document.visibilityState === "visible";

    function request() {
      if (scheduled || !visible()) return;
      scheduled = true;
      window.clearTimeout(timer);
      // Native reads cannot be cancelled. The next filter waits for the
      // running read, and filters already left never start their SQLite query.
      const task = (tail.current ?? Promise.resolve()).then(async () => {
        scheduled = false;
        if (!visible()) return;
        try {
          const value = await read();
          if (!disposed) {
            setSnapshot({ key, value });
            setFailure(null);
          }
        } catch (error) {
          if (!disposed) setFailure({ key, message: errText(error) });
        }
      });
      tail.current = task;
      void task.then(() => {
        if (tail.current !== task) return;
        tail.current = null;
        if (pollMs && visible()) timer = window.setTimeout(request, pollMs);
      });
    }
    function visibilityChanged() {
      if (document.visibilityState === "hidden") {
        window.clearTimeout(timer);
      } else {
        request();
      }
    }
    trigger.current = request;
    const subscriptions = [events.onActivityUpdated(request)];
    if (accounts) subscriptions.push(events.onAccountsUpdated(request));
    // Register first so an update cannot fall between the initial read and subscription.
    void Promise.allSettled(subscriptions).then(request);
    document.addEventListener("visibilitychange", visibilityChanged);
    if (onWindowFocus) window.addEventListener("focus", request);
    return () => {
      disposed = true;
      trigger.current = () => {};
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
      if (onWindowFocus) window.removeEventListener("focus", request);
      for (const subscription of subscriptions) void subscription.then(stop => stop()).catch(() => undefined);
    };
  }, [key, read, enabled, pollMs, accounts, onWindowFocus]);

  const data = enabled && snapshot?.key === key ? snapshot.value : null;
  const error = enabled && failure?.key === key ? failure.message : "";
  return { data, error, loading: enabled && data === null && !error, previous: snapshot?.value, reload };
}

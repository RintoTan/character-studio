import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A message that clears itself after a while.
 *
 * The single timer is the whole point. Each message used to arm its own timeout, so
 * a second action inside the window had its message cut off by the first one's
 * timer -- the later message disappeared early, having been given the remainder of
 * the earlier one's life. One timer, restarted on every call.
 *
 * The timer is cleared on unmount too: a pending `setTimeout` surviving the
 * component would fire into a dead tree.
 */
export function useTransientMessage(durationMs = 1800) {
  const [message, setMessage] = useState("");
  const timerRef = useRef<number | null>(null);

  const show = useCallback(
    (next: string) => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }

      setMessage(next);
      timerRef.current = window.setTimeout(() => {
        setMessage("");
        timerRef.current = null;
      }, durationMs);
    },
    [durationMs],
  );

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    },
    [],
  );

  return { message, show };
}

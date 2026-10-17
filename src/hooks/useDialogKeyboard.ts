import { useEffect, useRef } from "react";

type DialogKeyboardOptions = {
  /** Whether the dialog is on screen. A closed dialog installs nothing. */
  active: boolean;
  /** Escape, and the outcome that touches no data. */
  onClose?: () => void;
  /** Enter, from any field. Omit for a dialog with no single primary action. */
  onConfirm?: () => void;
  /** Blocks Enter while the primary action is not available yet. */
  confirmDisabled?: boolean;
  /**
   * Whether this hook owns Escape. A screen that already arbitrates its own dialogs
   * (the dashboard's layer stack) keeps that job: registering a second, independent
   * Escape there would close the dialog underneath the confirmation as well.
   */
  escape?: boolean;
};

/**
 * Keyboard control for one open modal.
 *
 * The dashboard, the editor and the app shell had each grown an Escape handler of
 * their own — and the three workspace screens had none, so a dialog there could only
 * be dismissed with the mouse. This is the one implementation, and it covers the
 * three things a dialog owes a keyboard:
 *
 *   - Escape closes it. Non-destructive by definition: cancel is the outcome that
 *     leaves the data alone, so a confirmation is the last place to refuse it.
 *   - Enter confirms, from any field. A focused button keeps Enter for itself —
 *     activation is already what Enter does there — and a textarea keeps it for a
 *     new line.
 *   - Focus moves into the dialog when it opens and back to where it came from when
 *     it closes, so a keyboard user is never left behind on the page underneath.
 *
 * `escape: false` keeps the second and third promises for dialogs whose screen
 * already owns the first.
 */
export function useDialogKeyboard({
  active,
  onClose,
  onConfirm,
  confirmDisabled = false,
  escape = true,
}: DialogKeyboardOptions) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }

    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusable = dialogRef.current?.querySelector<HTMLElement>(
      "input:not([type='hidden']), select, textarea, button, summary",
    );
    focusable?.focus();

    return () => {
      // Only if it is still on the page: the element a dialog was opened from can
      // itself have been replaced while the dialog was open.
      if (restoreRef.current?.isConnected) {
        restoreRef.current.focus();
      }
    };
  }, [active]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const handlesEscape = escape && Boolean(onClose);
    if (!handlesEscape && !onConfirm) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (handlesEscape) {
          onClose?.();
        }
        return;
      }

      if (event.key !== "Enter" || !onConfirm || confirmDisabled) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target?.tagName === "TEXTAREA" || target?.tagName === "BUTTON") {
        return;
      }

      event.preventDefault();
      onConfirm();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [active, escape, onClose, onConfirm, confirmDisabled]);

  return dialogRef;
}

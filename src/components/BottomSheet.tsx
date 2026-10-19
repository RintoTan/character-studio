import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogKeyboard } from "../hooks/useDialogKeyboard";
import { Icon } from "./Icon";

type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  /** A line under the title. Omit it where the rows already say what they are. */
  description?: string;
  children: ReactNode;
  /** Tests and callers that need a stable handle on this particular sheet. */
  testId?: string;
};

/**
 * The phone's sheet for a list of choices: navigation, and the dashboard's "more".
 *
 * It exists because the desktop pattern — a dropdown anchored under its trigger —
 * cannot work in a 375px column. Anchored to a button in the top-right, a 10-entry
 * menu runs off the right edge and off the bottom; anchored to a button at the
 * bottom of the screen, it has nowhere to go at all. A sheet is anchored to the
 * viewport instead: full width, rises from the bottom, scrolls inside itself, and
 * keeps clear of the home indicator.
 *
 * The rules it owes the reader:
 *   - Escape and the scrim both close it, and focus goes back to the trigger.
 *   - The page behind it does not scroll while it is open (iOS scrolls the body even
 *     when a fixed overlay covers it, otherwise).
 *   - A long list scrolls inside the sheet, not past the top of the screen.
 *   - Whatever the keyboard does to the viewport, the sheet is sized in dvh, so its
 *     height follows the visual viewport rather than a static 100vh.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  description,
  children,
  testId,
}: BottomSheetProps) {
  const panelRef = useDialogKeyboard({ active: open, onClose });

  useEffect(() => {
    if (!open) {
      return;
    }

    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";

    return () => {
      root.style.overflow = previous;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  // Portalled: the trigger sits in the top bar, and a fixed layer inside a bar with its
  // own blur becomes positioned against the bar instead of the viewport.
  return createPortal(
    <div className="sheet-layer" data-sheet-root="true" data-testid={testId}>
      {/* The scrim is the click target, not the layer: a drag that starts in the panel
          and ends outside it must not count as "dismiss". */}
      <div className="sheet-scrim" onMouseDown={onClose} />
      <div
        aria-label={title}
        aria-modal="true"
        className="sheet-panel"
        ref={panelRef}
        role="dialog"
      >
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button aria-label={`关闭${title}`} className="sheet-close" onClick={onClose} type="button">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

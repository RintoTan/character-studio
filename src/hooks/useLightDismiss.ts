import { useEffect, useRef } from "react";

/**
 * Dismissal for the layers that are not dialogs: the filter panels, the dropdown
 * menus, the little pickers. They all owe the reader the same four exits — click
 * outside, click the trigger again, Escape, and open a sibling — and each screen had
 * grown its own version of some of them.
 *
 * One stack, one key listener: the last layer opened is the first one Escape closes.
 * A modal owns Escape while it is on screen, so this ignores the key when one is
 * present; the modal's own handler is the one that runs.
 */
type LightLayer = {
  close: () => void;
};

const stack: LightLayer[] = [];
let listening = false;

function handleKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape" || stack.length === 0) {
    return;
  }

  // A dialog is above every light layer. Its own Escape handler decides what
  // cancelling means; closing a filter behind it would answer a different question.
  if (document.querySelector('[aria-modal="true"]')) {
    return;
  }

  stack[stack.length - 1].close();
}

function push(layer: LightLayer) {
  stack.push(layer);

  if (!listening) {
    document.addEventListener("keydown", handleKeyDown);
    listening = true;
  }

  return () => {
    const index = stack.indexOf(layer);
    if (index >= 0) {
      stack.splice(index, 1);
    }

    if (stack.length === 0 && listening) {
      document.removeEventListener("keydown", handleKeyDown);
      listening = false;
    }
  };
}

type LightDismissOptions = {
  open: boolean;
  onClose: () => void;
  /**
   * Everything that counts as "inside" this layer, including portalled content.
   * Defaults to the element the hook returns.
   */
  isInside?: (target: Node) => boolean;
};

/**
 * Returns the ref to put on the layer's own container. The caller keeps ownership of
 * the open state; this only decides when to ask for it to close.
 */
export function useLightDismiss({ open, onClose, isInside }: LightDismissOptions) {
  const ref = useRef<HTMLDivElement | null>(null);
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  const latestInside = useRef(isInside);
  latestInside.current = isInside;

  // The trigger is whatever had focus when the layer opened, so Escape puts the
  // keyboard back where it was. An outside click deliberately does not: focus is
  // already moving to whatever was clicked.
  const restoreRef = useRef<HTMLElement | null>(null);
  const closedByEscape = useRef(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closedByEscape.current = false;

    const close = () => {
      closedByEscape.current = true;
      latestClose.current();
    };
    const remove = push({ close });

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      const inside = latestInside.current
        ? latestInside.current(target)
        : Boolean(ref.current?.contains(target));

      if (!inside) {
        latestClose.current();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      remove();

      if (closedByEscape.current && restoreRef.current?.isConnected) {
        restoreRef.current.focus();
      }
    };
  }, [open]);

  return ref;
}

/** For a layer that already checks its own outside clicks and only needs Escape. */
export function useEscapeDismiss(open: boolean, onClose: () => void) {
  const latestClose = useRef(onClose);
  latestClose.current = onClose;

  useEffect(() => {
    if (!open) {
      return;
    }

    return push({ close: () => latestClose.current() });
  }, [open]);
}

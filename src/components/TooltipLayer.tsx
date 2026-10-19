import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const GAP = 6;
const MARGIN = 8;
const HOVER_DELAY = 220;
const TOUCH_DELAY = 450;

type OpenTooltip = {
  text: string;
  anchor: DOMRect;
};

/**
 * One tooltip for the whole app, drawn in a portal at the viewport edge rather than
 * inside the control's parent.
 *
 * The old version was a `::before` on two classes, pinned under the button at
 * `left: 50%`. That cannot flip when the button is near the bottom, cannot stay
 * inside the window at the right edge, and is clipped by any ancestor with
 * `overflow: hidden` — and the preview's icon buttons carried a `data-tooltip` with
 * no rule at all, so on a phone they had no label.
 *
 * A tooltip explains a control; it never accepts input. It is not the toast (which
 * reports what just happened) and not a popover (which holds choices).
 */
export function TooltipLayer() {
  const [open, setOpen] = useState<OpenTooltip | null>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    placement: "top" | "bottom";
  } | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let timer = 0;
    let anchor: HTMLElement | null = null;

    const hide = () => {
      window.clearTimeout(timer);
      anchor = null;
      setOpen(null);
      setPosition(null);
    };

    const show = (element: HTMLElement, delay: number) => {
      const text = element.getAttribute("data-tooltip")?.trim();
      if (!text) {
        return;
      }

      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!element.isConnected) {
          return;
        }
        anchor = element;
        setOpen({ text, anchor: element.getBoundingClientRect() });
      }, delay);
    };

    const triggerOf = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>("[data-tooltip]") : null;

    function handlePointerOver(event: PointerEvent) {
      // Touch has no hover. A finger that rests on a control is not asking for its
      // name, so the press-based path below is the only one a phone uses.
      if (event.pointerType === "touch") {
        return;
      }

      const element = triggerOf(event.target);
      if (!element) {
        return;
      }
      if (event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) {
        return;
      }

      show(element, HOVER_DELAY);
    }

    function handlePointerOut(event: PointerEvent) {
      if (event.pointerType === "touch") {
        return;
      }

      const element = triggerOf(event.target);
      if (!element) {
        return;
      }
      if (event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) {
        return;
      }

      if (anchor === element) {
        hide();
      }
    }

    function handlePointerDown(event: PointerEvent) {
      const element = triggerOf(event.target);

      if (event.pointerType !== "touch") {
        // A click is about to do something; the label has done its job.
        hide();
        return;
      }

      if (!element) {
        hide();
        return;
      }

      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (element.isConnected) {
          anchor = element;
          setOpen({ text: element.getAttribute("data-tooltip") ?? "", anchor: element.getBoundingClientRect() });
        }
      }, TOUCH_DELAY);
    }

    function handlePointerUp() {
      if (open) {
        hide();
      } else {
        window.clearTimeout(timer);
      }
    }

    function handleFocusIn(event: FocusEvent) {
      const element = triggerOf(event.target);
      if (element) {
        show(element, 0);
      }
    }

    function handleFocusOut() {
      hide();
    }

    document.addEventListener("pointerover", handlePointerOver);
    document.addEventListener("pointerout", handlePointerOut);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerUp);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerover", handlePointerOver);
      document.removeEventListener("pointerout", handlePointerOut);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerUp);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
    // Re-binding on every open would drop the very pointerout that closes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Measured after render, so a two-line label is placed by its real height.
  useLayoutEffect(() => {
    if (!open || !tipRef.current) {
      return;
    }

    const box = tipRef.current.getBoundingClientRect();
    const below = open.anchor.bottom + GAP;
    const above = open.anchor.top - GAP - box.height;
    const fitsBelow = below + box.height <= window.innerHeight - MARGIN;
    const fitsAbove = above >= MARGIN;

    const placement = fitsBelow || !fitsAbove ? "bottom" : "top";
    const top = placement === "bottom" ? below : above;
    const centred = open.anchor.left + open.anchor.width / 2 - box.width / 2;
    const left = Math.max(MARGIN, Math.min(centred, window.innerWidth - MARGIN - box.width));

    setPosition({
      // Never cover the trigger: if neither side has room, the label is pushed back
      // into the window rather than onto the control it describes.
      top: Math.max(MARGIN, Math.min(top, window.innerHeight - MARGIN - box.height)),
      left,
      placement,
    });
  }, [open]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      className="app-tooltip"
      data-placement={position?.placement ?? "bottom"}
      ref={tipRef}
      role="tooltip"
      style={{
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        visibility: position ? "visible" : "hidden",
      }}
    >
      {open.text}
    </div>,
    document.body,
  );
}

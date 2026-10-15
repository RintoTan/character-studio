// @vitest-environment happy-dom
import { act, createElement, type FC } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDialogKeyboard } from "../src/hooks/useDialogKeyboard";

// React 18 wants this before `act` is used outside a test-framework integration,
// and the project deliberately carries no @testing-library dependency.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Options = {
  active: boolean;
  onClose: () => void;
  onConfirm?: () => void;
  confirmDisabled?: boolean;
};

function mountDialog(options: Options) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const Dialog: FC<Options> = (props) => {
    const ref = useDialogKeyboard(props);
    return createElement(
      "div",
      { id: "dialog", ref },
      createElement("input", { id: "field" }),
      createElement("textarea", { id: "area" }),
      createElement("button", { id: "btn" }, "confirm"),
    );
  };

  const render = (next: Options) => {
    act(() => {
      root.render(createElement(Dialog, next));
    });
  };

  render(options);

  return {
    render,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

const press = (target: EventTarget, key: string) => {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
};

const element = (id: string) => document.getElementById(id) as HTMLElement;

const mounted: Array<{ unmount: () => void }> = [];
const track = <T extends { unmount: () => void }>(dialog: T): T => {
  mounted.push(dialog);
  return dialog;
};

afterEach(() => {
  while (mounted.length) {
    mounted.pop()?.unmount();
  }
  document.body.innerHTML = "";
});

describe("useDialogKeyboard", () => {
  it("closes on Escape", () => {
    const onClose = vi.fn();
    track(mountDialog({ active: true, onClose }));

    press(document, "Escape");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("installs nothing while the dialog is closed", () => {
    const onClose = vi.fn();
    track(mountDialog({ active: false, onClose }));

    press(document, "Escape");

    expect(onClose).not.toHaveBeenCalled();
  });

  it("stops listening once the dialog closes", () => {
    const onClose = vi.fn();
    const dialog = track(mountDialog({ active: true, onClose }));

    dialog.render({ active: false, onClose });
    press(document, "Escape");

    expect(onClose).not.toHaveBeenCalled();
  });

  it("confirms on Enter from a text field", () => {
    const onConfirm = vi.fn();
    track(mountDialog({ active: true, onClose: vi.fn(), onConfirm }));

    press(element("field"), "Enter");

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("leaves Enter alone when the focus is on a button", () => {
    const onConfirm = vi.fn();
    track(mountDialog({ active: true, onClose: vi.fn(), onConfirm }));

    // Enter on a button is the button's own activation; confirming as well would
    // run the action twice.
    press(element("btn"), "Enter");

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("leaves Enter alone inside a textarea, where it means a new line", () => {
    const onConfirm = vi.fn();
    track(mountDialog({ active: true, onClose: vi.fn(), onConfirm }));

    press(element("area"), "Enter");

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("does nothing on Enter when the dialog has no primary action", () => {
    const onClose = vi.fn();
    track(mountDialog({ active: true, onClose }));

    press(element("field"), "Enter");

    expect(onClose).not.toHaveBeenCalled();
  });

  it("refuses Enter while the primary action is not available yet", () => {
    const onConfirm = vi.fn();
    track(mountDialog({ active: true, onClose: vi.fn(), onConfirm, confirmDisabled: true }));

    press(element("field"), "Enter");

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("moves focus into the dialog on open and back where it came from on close", () => {
    const opener = document.createElement("button");
    opener.id = "opener";
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const onClose = vi.fn();
    const dialog = track(mountDialog({ active: true, onClose }));
    expect(document.activeElement).toBe(element("field"));

    dialog.render({ active: false, onClose });

    expect(document.activeElement).toBe(opener);
  });

  it("does not chase focus back to an element that has left the page", () => {
    const opener = document.createElement("button");
    opener.id = "opener";
    document.body.appendChild(opener);
    opener.focus();

    const onClose = vi.fn();
    const dialog = track(mountDialog({ active: true, onClose }));
    opener.remove();

    expect(() => dialog.render({ active: false, onClose })).not.toThrow();
    expect(document.activeElement).not.toBe(opener);
  });
});

// @vitest-environment happy-dom
import { act, createElement, type FC } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTransientMessage } from "../src/hooks/useTransientMessage";

// React 18 wants this before `act` is used outside a test-framework integration,
// and the project deliberately carries no @testing-library dependency.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Mounts a hook through a component, since that is the only way to run one. The
 * probe renders nothing; it just publishes the hook's current return value.
 */
function mountHook<T>(useHook: () => T) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const holder: { current: T } = { current: undefined as unknown as T };

  const Probe: FC = () => {
    holder.current = useHook();
    return null;
  };

  act(() => {
    root.render(createElement(Probe));
  });

  return {
    read: () => holder.current,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("useTransientMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  it("shows a message, then clears it after the duration", () => {
    const app = mountHook(() => useTransientMessage(1000));

    act(() => app.read().show("已保存"));
    expect(app.read().message).toBe("已保存");

    advance(999);
    expect(app.read().message).toBe("已保存");

    advance(1);
    expect(app.read().message).toBe("");
  });

  it("gives a second message its own full time, not the first one's leftovers", () => {
    // The bug the single timer exists for. One timeout per message meant the second
    // message inherited whatever was left of the first: it appeared and then
    // vanished almost immediately, which reads as "the toast didn't show".
    const app = mountHook(() => useTransientMessage(1000));

    act(() => app.read().show("第一条"));
    advance(900);
    act(() => app.read().show("第二条"));

    // The first message's timer would have fired by now.
    advance(100);
    expect(app.read().message).toBe("第二条");

    // The second message still gets its own full second.
    advance(899);
    expect(app.read().message).toBe("第二条");

    advance(1);
    expect(app.read().message).toBe("");
  });

  it("restarts rather than stacking timers", () => {
    const app = mountHook(() => useTransientMessage(1000));

    act(() => app.read().show("a"));
    act(() => app.read().show("b"));
    act(() => app.read().show("c"));

    advance(1000);
    expect(app.read().message).toBe("");

    // A leaked timer firing here would write into a settled component.
    advance(5000);
    expect(app.read().message).toBe("");
  });

  it("clears a pending timer when the component goes away", () => {
    const clearSpy = vi.spyOn(window, "clearTimeout");
    const app = mountHook(() => useTransientMessage(1000));

    act(() => app.read().show("bye"));
    const before = clearSpy.mock.calls.length;
    app.unmount();

    expect(clearSpy.mock.calls.length).toBeGreaterThan(before);
  });

  it("honours a custom duration", () => {
    const app = mountHook(() => useTransientMessage(300));

    act(() => app.read().show("短"));
    advance(299);
    expect(app.read().message).toBe("短");
    advance(1);
    expect(app.read().message).toBe("");
  });
});

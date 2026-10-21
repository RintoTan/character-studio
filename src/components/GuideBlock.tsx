import { useEffect, useState } from "react";
import { Icon, type IconName } from "./Icon";

/**
 * The flat guide block every workspace shares.
 *
 * The relationship graph grew this shape first: a section title, one tip at a time,
 * two circular pagers, no card, no shadow, no collapse. It lives in the page flow under
 * the work rather than floating over it, because a help block is a line of the page, not
 * a window to look through.
 *
 * 时间线 and 世界观 need the same thing, and three copies of the keyboard handling, the
 * loop arithmetic and the live region would drift apart within a release. So the
 * mechanism is here once and the tips are passed in.
 *
 * The rules the block guarantees, whatever the tips say:
 *   - one tip at a time, default expanded, no collapse;
 *   - `1 → 2 → … → n → 1` in both directions, so a pager is never disabled;
 *   - arrows only while focus is inside the block, so a canvas or a text field keeps its
 *     own arrow keys;
 *   - the tip text sits in a polite live region: a screen reader hears the change, and
 *     nothing is announced on load.
 */
export type GuideTip = {
  title: string;
  body: string;
  hint: string;
  icon: IconName;
};

export default function GuideBlock({
  id,
  title = "使用指南",
  tips,
  legacyKey,
  className = "",
}: {
  /** Unique per page: the section is labelled by its own heading. */
  id: string;
  title?: string;
  tips: GuideTip[];
  /** A key an older build used to persist a collapsed state. Cleared, never read. */
  legacyKey?: string;
  className?: string;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!legacyKey) {
      return;
    }
    try {
      // Read as "the old design is gone": someone returning in the same session must not
      // open the page onto an empty band with no control to bring it back.
      sessionStorage.removeItem(legacyKey);
    } catch {
      // A blocked storage is not a reason to lose the guide.
    }
  }, [legacyKey]);

  if (tips.length === 0) {
    return null;
  }

  const current = Math.min(index, tips.length - 1);
  const tip = tips[current];

  function go(delta: number) {
    setIndex((value) => (value + delta + tips.length) % tips.length);
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className={className ? `graph-guide ${className}` : "graph-guide"}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement | null;

        if (
          target &&
          (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
        ) {
          return;
        }

        if (event.key === "ArrowRight") {
          event.preventDefault();
          go(1);
        }

        if (event.key === "ArrowLeft") {
          event.preventDefault();
          go(-1);
        }
      }}
      tabIndex={0}
    >
      <header className="graph-guide-head">
        <h2 id={`${id}-title`}>{title}</h2>
        <div className="graph-guide-tools">
          <span className="graph-guide-count">
            {current + 1} / {tips.length}
          </span>
          <button aria-label="上一张提示" className="graph-guide-step" onClick={() => go(-1)} type="button">
            <Icon name="chevronLeft" size={16} />
          </button>
          <button aria-label="下一张提示" className="graph-guide-step" onClick={() => go(1)} type="button">
            <Icon name="chevronRight" size={16} />
          </button>
        </div>
      </header>

      <div aria-live="polite" className="graph-guide-card">
        <h3>
          <Icon name={tip.icon} size={15} />
          {tip.title}
        </h3>
        <p>{tip.body}</p>
        <p className="graph-guide-hint">{tip.hint}</p>
      </div>
    </section>
  );
}

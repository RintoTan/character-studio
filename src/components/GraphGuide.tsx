import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

/**
 * The four things a first visit cannot guess, as a flat band under the drawing.
 *
 * It used to be a stack of three cards, which read as a window floating over the
 * canvas and put three white edges between the drawing and the footer. A help block
 * is not a thing to be looked *through*: it is one line of the page, aligned with the
 * canvas above it, titled like a section, and it shows one card at a time.
 *
 * The collapsed state is a reading preference, so it lives in sessionStorage and
 * nowhere near the character data: closing the guide must not touch the graph, and a
 * backup must not carry it.
 */
const STORAGE_KEY = "character-studio.graph-guide";

type Card = { title: string; body: string; hint: string; icon: "select" | "fit" | "layout" | "sliders" };

const CARDS: Card[] = [
  {
    icon: "select",
    title: "自由选择和移动角色",
    body: "点击角色进行选择，切到选择工具后在空白处拖动即可框选多个角色。按住 Shift 点击可以加选或取消。",
    hint: "拖动任意一个已选角色，整组一起移动，关系线与分组边框会跟着走。",
  },
  {
    icon: "fit",
    title: "像白板一样探索关系",
    body: "拖动空白区域平移画布，按住 Ctrl/Cmd 滚动滚轮以指针为中心缩放。",
    hint: "找不到内容时点「适应画布」；空格加拖动是临时的平移，松开即恢复。",
  },
  {
    icon: "layout",
    title: "让关系图更有秩序",
    body: "「整理」提供关系聚类、环形、网格、层级与按尺寸排开，选好后先预览，再决定是否应用。",
    hint: "选中两个以上角色可以对齐，三个以上可以等距分布，撤销随时可用。",
  },
  {
    icon: "sliders",
    title: "打造自己的关系网",
    body: "「外观」可以切换视觉预设、调整画布底色与单个角色或关系线的样式，改动即时生效。",
    hint: "「导出」支持 PNG、SVG、JPG 与 PDF，可选比例与 1x/2x/3x 分辨率。",
  },
];

export default function GraphGuide() {
  const [index, setIndex] = useState(0);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === "collapsed";
    } catch {
      return false;
    }
  });
  const sectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    try {
      if (collapsed) {
        sessionStorage.setItem(STORAGE_KEY, "collapsed");
      } else {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // A blocked storage is not a reason to lose the guide.
    }
  }, [collapsed]);

  if (collapsed) {
    return (
      <div className="graph-guide is-collapsed">
        <button className="ghost-button graph-guide-open" onClick={() => setCollapsed(false)} type="button">
          <Icon name="sparkles" size={15} />
          使用指南
        </button>
      </div>
    );
  }

  const card = CARDS[index];

  function go(delta: number) {
    setIndex((current) => Math.min(CARDS.length - 1, Math.max(0, current + delta)));
    sectionRef.current?.focus();
  }

  return (
    <section
      aria-labelledby="graph-guide-title"
      className="graph-guide"
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          go(1);
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          go(-1);
        }
      }}
      ref={sectionRef}
      tabIndex={-1}
    >
      <header className="graph-guide-head">
        <h2 id="graph-guide-title">
          <Icon name="sparkles" size={15} />
          使用指南
        </h2>
        <div className="graph-guide-tools">
          <span aria-live="polite" className="graph-guide-count">
            {index + 1} / {CARDS.length}
          </span>
          <button
            aria-label="上一张提示"
            className="graph-guide-step"
            disabled={index === 0}
            onClick={() => go(-1)}
            type="button"
          >
            <Icon name="chevronLeft" size={16} />
          </button>
          <button
            aria-label="下一张提示"
            className="graph-guide-step"
            disabled={index === CARDS.length - 1}
            onClick={() => go(1)}
            type="button"
          >
            <Icon name="chevronRight" size={16} />
          </button>
          <span aria-hidden="true" className="graph-guide-divider" />
          <button className="graph-guide-collapse" onClick={() => setCollapsed(true)} type="button">
            收起
          </button>
        </div>
      </header>

      <div className="graph-guide-body">
        <span aria-hidden="true" className="graph-guide-icon">
          <Icon name={card.icon} size={18} />
        </span>
        <div className="graph-guide-copy">
          <h3>{card.title}</h3>
          <p>{card.body}</p>
          <p className="graph-guide-hint">{card.hint}</p>
        </div>
      </div>
    </section>
  );
}

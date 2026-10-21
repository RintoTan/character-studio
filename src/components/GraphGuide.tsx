import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

/**
 * The four things a first visit cannot guess.
 *
 * It sits under the drawing rather than over it: the canvas is the work, and a help
 * panel that covers it would be the thing it is explaining how to avoid. It is one
 * card deep — the two cards behind it are edges, not a stack of windows — so nothing
 * can be hidden behind anything else.
 *
 * The collapsed state is a reading preference, so it lives in sessionStorage and
 * nowhere near the character data: closing the guide must not touch the graph, and a
 * backup must not carry it.
 */
const STORAGE_KEY = "character-studio.graph-guide";

type Card = { title: string; body: string; hint?: string };

const CARDS: Card[] = [
  {
    title: "自由选择和移动角色",
    body: "点击角色进行选择，切到选择工具后在空白处拖动即可框选多个角色。按住 Shift 点击可以加选或取消。",
    hint: "拖动任意一个已选角色，整组一起移动，关系线与分组边框会跟着走。",
  },
  {
    title: "像白板一样探索关系",
    body: "拖动空白区域平移画布，按住 Ctrl/Cmd 滚动滚轮以指针为中心缩放。",
    hint: "找不到内容时点「适应画布」；空格加拖动是临时的平移，松开即恢复。",
  },
  {
    title: "让关系图更有秩序",
    body: "「整理」提供关系聚类、环形、网格、层级与按尺寸排开，选好后先预览，再决定是否应用。",
    hint: "选中两个以上角色可以对齐，三个以上可以等距分布，撤销随时可用。",
  },
  {
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
  const stackRef = useRef<HTMLDivElement | null>(null);

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
      <div className="graph-guide collapsed">
        <button className="ghost-button graph-guide-open" onClick={() => setCollapsed(false)} type="button">
          <Icon name="sparkles" size={15} />
          使用指南
        </button>
      </div>
    );
  }

  const card = CARDS[index];

  function focusCard(delta: number) {
    const next = (index + delta + CARDS.length) % CARDS.length;
    setIndex(next);
    // Focus follows the card so a keyboard reader is not left on a button whose
    // meaning changed beneath them.
    stackRef.current?.focus();
  }

  return (
    <div
      aria-label="使用指南"
      aria-roledescription="轮播"
      className="graph-guide"
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          focusCard(1);
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          focusCard(-1);
        }
      }}
      ref={stackRef}
      role="group"
      tabIndex={-1}
    >
      <div className="graph-guide-stack">
        {/* Two edges, not two windows: they advertise that there is more, and any of
            them can be pressed to go there. */}
        {[2, 1].map((depth) => (
          <button
            aria-label={`前往第 ${((index + depth) % CARDS.length) + 1} 张提示`}
            className={`graph-guide-edge depth-${depth}`}
            key={depth}
            onClick={() => focusCard(depth)}
            tabIndex={-1}
            type="button"
          />
        ))}

        <article className="graph-guide-card" data-index={index}>
          <header>
            <span className="graph-guide-count">
              {index + 1} / {CARDS.length}
            </span>
            <button
              aria-label="收起使用指南"
              className="graph-guide-collapse"
              onClick={() => setCollapsed(true)}
              type="button"
            >
              <Icon name="chevronDown" size={16} />
            </button>
          </header>
          <h3>{card.title}</h3>
          <p>{card.body}</p>
          {card.hint && <p className="graph-guide-hint">{card.hint}</p>}
          <footer>
            <button
              aria-label="上一张提示"
              className="ghost-button graph-guide-step"
              disabled={index === 0}
              onClick={() => focusCard(-1)}
              type="button"
            >
              <Icon name="chevronLeft" size={15} />
              上一张
            </button>
            <button
              aria-label="下一张提示"
              className="ghost-button graph-guide-step"
              disabled={index === CARDS.length - 1}
              onClick={() => focusCard(1)}
              type="button"
            >
              下一张
              <Icon name="chevronRight" size={15} />
            </button>
          </footer>
        </article>
      </div>
    </div>
  );
}

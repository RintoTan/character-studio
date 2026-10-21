import { useMemo } from "react";
import GuideBlock, { type GuideTip } from "./GuideBlock";
import { inputPlatformOf, type InputPlatform } from "../utils/inputPlatform";

/**
 * The four things a first visit to the relationship graph cannot guess.
 *
 * The mechanism — one tip at a time, a loop, focus-scoped arrows — lives in
 * GuideBlock, because 时间线 and 世界观 need the same block. What is specific here is
 * the wording, and the wording follows the input device: a phone has no Shift key and
 * no wheel, a Mac has Command, and a Windows machine has Ctrl. Telling all three the
 * same sentence is how a guide teaches a gesture that does not exist on the device
 * being held.
 */
const LEGACY_KEY = "character-studio.graph-guide";

function tipsFor(platform: InputPlatform): GuideTip[] {
  const mac = platform === "mac";
  const touch = platform === "touch";

  return [
    {
      icon: "select",
      title: "自由选择和移动角色",
      body: touch
        ? "点按角色选中；切换到选择工具后，在空白处拖动可以框选多个角色。手机没有 Shift，多选就靠选择工具。"
        : `点击角色选中；切换到选择工具后，在空白处拖动即可框选多个角色。按住 ${mac ? "Shift" : "Shift"} 点击可以加选或取消。`,
      hint: "拖动任意一个已选角色，整组一起移动，关系线与分组边框会跟着走。",
    },
    {
      icon: "fit",
      title: "像白板一样探索关系",
      body: touch
        ? "单指拖动空白处平移画布，双指捏合缩放。缩放以两指中心为基准。"
        : mac
          ? "拖动空白处平移画布；Command（⌘）加滚轮以指针为中心缩放，触控板双指捏合同样有效。"
          : "拖动空白处平移画布；按住 Ctrl 滚动滚轮，以指针为中心缩放。",
      hint: touch
        ? "找不到内容时点「适应画布」；缩放与适应都在左下工具坞里。"
        : mac
          ? "空格加拖动、或中键拖动都可以临时平移（触控板没有中键）。想回到全图时点「适应画布」。"
          : "空格加拖动、或中键拖动都可以临时平移。想回到全图时点「适应画布」。",
    },
    {
      icon: "layout",
      title: "让关系图更有秩序",
      body: "「整理」提供关系聚类、环形、网格、层级与按尺寸排开。选一种先看预览，确认后才写入坐标。",
      hint: "预览期间可以继续切换布局比较；取消、关闭面板或改切其它工具，都会回到整理前的坐标与视角。",
    },
    {
      icon: "sliders",
      title: "打造自己的关系网",
      body: "「设计」可以切换视觉预设、调整画布底色与网格，也能只改所选角色或关系线的样式。",
      hint: "「导出」支持 PNG、SVG、JPG 与 PDF，可选比例与 1x/2x/3x 分辨率。",
    },
  ];
}

export default function GraphGuide() {
  const platform = useMemo<InputPlatform>(() => {
    if (typeof navigator === "undefined") {
      return "windows";
    }

    return inputPlatformOf({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints ?? 0,
      coarsePointer:
        typeof window !== "undefined" && typeof window.matchMedia === "function"
          ? window.matchMedia("(pointer: coarse)").matches
          : false,
    });
  }, []);

  return <GuideBlock id="graph-guide" legacyKey={LEGACY_KEY} tips={tipsFor(platform)} />;
}

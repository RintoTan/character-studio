// What the editor knows about its own sections: the order, the label shown in
// the rail, and what "done" means for each. It lived inside the 3,600-line page,
// which made the rule that decides "已完成" impossible to test on its own — and
// that rule is a contract, because the rail's progress count and the jump control
// both read it.

import { EDITOR_SECTION_IDS, type EditorSectionId } from "../../storage/editorUiState";

export type EditorSectionMeta = {
  id: EditorSectionId;
  title: string;
  description: string;
};

export const EDITOR_SECTIONS: EditorSectionMeta[] = [
  { id: "basic", title: "基础信息", description: "角色身份、头像与基础档案。" },
  { id: "appearance", title: "外貌设定", description: "角色可视化的轮廓、服装与标志物。" },
  { id: "personality", title: "性格设定", description: "用标签和短描述确定角色气质。" },
  { id: "ability", title: "能力设定", description: "技能、限制、战斗或特殊天赋。" },
  { id: "backstory", title: "背景故事", description: "经历、关系、目标与隐藏秘密。" },
  { id: "prompt", title: "AI Prompt", description: "本地生成关键词和英文绘图 Prompt。" },
];

const SHORT_TITLES: Record<EditorSectionId, string> = {
  basic: "基础",
  appearance: "外貌",
  personality: "性格",
  ability: "能力",
  backstory: "背景",
  prompt: "Prompt",
};

export function sectionShortTitle(sectionId: EditorSectionId) {
  return SHORT_TITLES[sectionId];
}

/** Only the fields the completion rule actually reads. */
export type SectionCompletionInput = {
  name?: string;
  gender?: string;
  species?: string;
  occupation?: string;
  worldview?: string;
  appearanceDescription?: string;
  visualStyle?: string;
  personalityTags?: string[];
  abilityDescription?: string;
  backstory?: string;
  characterKeywords?: string;
  imagePrompt?: string;
};

export type CompletionStatus = "未完成" | "部分完成" | "已完成";

export function completionStatus(
  sectionId: EditorSectionId,
  data: SectionCompletionInput,
): CompletionStatus {
  const checks: Record<EditorSectionId, boolean[]> = {
    basic: [data.name, data.gender, data.species, data.occupation, data.worldview].map(Boolean),
    appearance: [Boolean(data.appearanceDescription), Boolean(data.visualStyle)],
    personality: [Boolean(data.personalityTags?.length)],
    ability: [Boolean(data.abilityDescription)],
    backstory: [Boolean(data.backstory)],
    prompt: [Boolean(data.characterKeywords), Boolean(data.imagePrompt)],
  };
  const values = checks[sectionId];
  const filled = values.filter(Boolean).length;

  if (filled === 0) {
    return "未完成";
  }

  return filled === values.length ? "已完成" : "部分完成";
}

export function unfinishedSections(data: SectionCompletionInput) {
  return EDITOR_SECTIONS.filter((section) => completionStatus(section.id, data) !== "已完成");
}

/** The section the "next unfinished" control should land on, wrapping at the end. */
export function nextUnfinishedSection(
  data: SectionCompletionInput,
  activeId: EditorSectionId,
  visibleIds: readonly EditorSectionId[] = EDITOR_SECTION_IDS,
) {
  const pending = visibleIds.filter((id) => completionStatus(id, data) !== "已完成");

  if (pending.length === 0) {
    return null;
  }

  const activeIndex = visibleIds.indexOf(activeId);
  const after = pending.find((id) => visibleIds.indexOf(id) > activeIndex);

  return after ?? pending[0];
}

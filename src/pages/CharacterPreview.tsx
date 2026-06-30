import { useRef, useState } from "react";
import type { Character } from "../types/character";
import { exportCharacterJson, exportPreviewPdf } from "../utils/importExport";

type CharacterPreviewProps = {
  character: Character;
  onBack: () => void;
  onEdit?: () => void;
};

const basicFields: Array<[keyof Character, string]> = [
  ["gender", "性别"],
  ["age", "年龄"],
  ["species", "种族"],
  ["occupation", "职业"],
  ["worldview", "世界观"],
];

function displayValue(value?: string) {
  return value?.trim() || "未填写";
}

function buildFullCharacterText(character: Character) {
  return [
    `角色名：${displayValue(character.name)}`,
    `性别：${displayValue(character.gender)}`,
    `年龄：${displayValue(character.age)}`,
    `种族：${displayValue(character.species)}`,
    `职业：${displayValue(character.occupation)}`,
    `世界观：${displayValue(character.worldview)}`,
    `性格标签：${
      character.personalityTags?.length
        ? character.personalityTags.join("、")
        : "未填写"
    }`,
    `视觉风格：${displayValue(character.visualStyle)}`,
    `外貌描述：${displayValue(character.appearanceDescription)}`,
    `能力描述：${displayValue(character.abilityDescription)}`,
    `背景故事：${displayValue(character.backstory)}`,
    `中文人物关键词：${displayValue(character.characterKeywords)}`,
    `英文 AI Prompt：${displayValue(character.imagePrompt)}`,
  ].join("\n");
}

export function CharacterPreview({ character, onBack, onEdit }: CharacterPreviewProps) {
  const [toastMessage, setToastMessage] = useState("");
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  function showToast(message: string) {
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(""), 3000);
  }

  async function copyText(text: string, message: string) {
    await navigator.clipboard.writeText(text || "未填写");
    showToast(message);
  }

  function handleExportJson() {
    setLoadingAction("json");
    exportCharacterJson(character);
    showToast("当前角色 JSON 已导出");
    window.setTimeout(() => setLoadingAction(null), 300);
  }

  async function handleExportPdf() {
    if (!previewRef.current) {
      showToast("找不到可导出的角色展示区域");
      return;
    }

    setLoadingAction("pdf");

    try {
      await exportPreviewPdf(previewRef.current, character.name || "未命名角色");
      showToast("PDF 已导出");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "PDF 导出失败，请稍后重试");
    } finally {
      setLoadingAction(null);
    }
  }

  return (
    <section className="preview-page">
      {toastMessage && <div className="toast">{toastMessage}</div>}

      <div ref={previewRef} data-pdf-export-root="true">
        <div className="preview-hero">
          <div className="preview-identity">
            <div className="preview-avatar" aria-hidden="true">
              {character.avatarEmoji || "🙂"}
            </div>
            <div>
            <p className="eyebrow">Character Preview</p>
            <h1>{displayValue(character.name)}</h1>
            <p className="muted">
              {displayValue(character.occupation)} /{" "}
              {displayValue(character.worldview)}
            </p>
            </div>
          </div>
          <div className="preview-actions" data-pdf-hidden="true">
            {onEdit && (
              <button className="ghost-button" onClick={onEdit} type="button">
                编辑
              </button>
            )}
            <button
              className="ghost-button"
              onClick={() =>
                copyText(buildFullCharacterText(character), "完整角色设定已复制")
              }
              type="button"
            >
              复制完整设定
            </button>
            <button
              className="ghost-button"
              disabled={loadingAction === "json"}
              onClick={handleExportJson}
              type="button"
            >
              {loadingAction === "json" ? "导出中..." : "导出 JSON"}
            </button>
            <button
              className="ghost-button"
              disabled={loadingAction === "pdf"}
              onClick={handleExportPdf}
              type="button"
            >
              {loadingAction === "pdf" ? "导出中..." : "导出 PDF"}
            </button>
            <button className="ghost-button" onClick={onBack} type="button">
              返回
            </button>
          </div>
        </div>

        <div className="preview-layout">
          <article className="preview-card basic-card">
            <div className="preview-card-title">
              <h2>基础资料</h2>
            </div>
            <div className="basic-grid">
              {basicFields.map(([key, label]) => (
                <div className="basic-item" key={key}>
                  <span>{label}</span>
                  <strong>{displayValue(character[key] as string)}</strong>
                </div>
              ))}
            </div>
          </article>

          <article className="preview-card">
            <div className="preview-card-title">
              <h2>性格标签</h2>
            </div>
            {character.personalityTags?.length ? (
              <div className="preview-tags">
                {character.personalityTags.slice(0, 5).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            ) : (
              <p>未填写</p>
            )}
          </article>

          <article className="preview-card">
            <div className="preview-card-title">
              <h2>视觉风格</h2>
            </div>
            <p>{displayValue(character.visualStyle)}</p>
          </article>

          <article className="preview-card wide-card">
            <div className="preview-card-title">
              <h2>外貌描述</h2>
            </div>
            <p>{displayValue(character.appearanceDescription)}</p>
          </article>

          <article className="preview-card wide-card">
            <div className="preview-card-title">
              <h2>能力描述</h2>
            </div>
            <p>{displayValue(character.abilityDescription)}</p>
          </article>

          <article className="preview-card wide-card">
            <div className="preview-card-title">
              <h2>背景故事</h2>
            </div>
            <p>{displayValue(character.backstory)}</p>
          </article>

          <article className="preview-card wide-card">
            <div className="preview-card-title">
              <h2>中文人物关键词</h2>
              <button
                className="ghost-button"
                onClick={() =>
                  copyText(
                    displayValue(character.characterKeywords),
                    "中文人物关键词已复制",
                  )
                }
                type="button"
              >
                复制
              </button>
            </div>
            <p>{displayValue(character.characterKeywords)}</p>
          </article>

          <article className="preview-card wide-card">
            <div className="preview-card-title">
              <h2>英文 AI Prompt</h2>
              <button
                className="ghost-button"
                onClick={() =>
                  copyText(displayValue(character.imagePrompt), "英文 Prompt 已复制")
                }
                type="button"
              >
                复制
              </button>
            </div>
            <p>{displayValue(character.imagePrompt)}</p>
          </article>
        </div>
      </div>
    </section>
  );
}

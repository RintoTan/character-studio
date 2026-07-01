import { useEffect, useRef, useState } from "react";
import type { Character } from "../types/character";
import { exportCharacterJson, exportPreviewImage, exportPreviewPdf } from "../utils/importExport";

type CharacterPreviewProps = {
  character: Character;
  onBack: () => void;
  onEdit?: () => void;
  onToggleFavorite?: () => void;
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

export function CharacterPreview({ character, onBack, onEdit, onToggleFavorite }: CharacterPreviewProps) {
  const [toastMessage, setToastMessage] = useState("");
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const isFavorite = Boolean(character.favorite ?? character.isFavorite);

  function showToast(message: string) {
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(""), 3000);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsExportOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

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

  async function handleExportImage(format: "jpg" | "png") {
    if (!previewRef.current) {
      showToast("找不到可导出的角色展示区域");
      return;
    }

    setLoadingAction(format);

    try {
      await exportPreviewImage(previewRef.current, character.name || "未命名角色", format);
      showToast(`${format.toUpperCase()} 已导出`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : `${format.toUpperCase()} 导出失败`);
    } finally {
      setLoadingAction(null);
    }
  }

  function runExport(format: "json" | "pdf" | "jpg" | "png") {
    setIsExportOpen(false);

    if (format === "json") {
      handleExportJson();
      return;
    }

    if (format === "pdf") {
      void handleExportPdf();
      return;
    }

    void handleExportImage(format);
  }

  return (
    <section className="preview-page">
      {toastMessage && <div className="toast">{toastMessage}</div>}
      {isExportOpen && (
        <div
          className="modal-backdrop export-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsExportOpen(false);
            }
          }}
          role="presentation"
        >
          <div className="export-dialog" role="dialog" aria-modal="true">
            <div className="preview-card-title">
              <div>
                <p className="eyebrow">Export</p>
                <h2>导出角色</h2>
              </div>
              <button
                className="ghost-button"
                onClick={() => setIsExportOpen(false)}
                type="button"
              >
                关闭
              </button>
            </div>
            <div className="export-dialog-list">
              <button onClick={() => runExport("json")} type="button">
                导出 JSON
              </button>
              <button onClick={() => runExport("pdf")} type="button">
                {loadingAction === "pdf" ? "导出中..." : "导出 PDF"}
              </button>
              <button onClick={() => runExport("jpg")} type="button">
                {loadingAction === "jpg" ? "导出中..." : "导出 JPG"}
              </button>
              <button onClick={() => runExport("png")} type="button">
                {loadingAction === "png" ? "导出中..." : "导出 PNG"}
              </button>
            </div>
          </div>
        </div>
      )}

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
              <button
                aria-label="编辑"
                className="ghost-button preview-action-button"
                data-tooltip="编辑"
                onClick={onEdit}
                type="button"
              >
                <span className="desktop-label">编辑</span>
                <span className="mobile-icon">✎</span>
              </button>
            )}
            {onToggleFavorite && (
              <button
                aria-label={isFavorite ? "移出收藏" : "加入收藏"}
                className={isFavorite ? "ghost-button preview-action-button active" : "ghost-button preview-action-button"}
                data-tooltip={isFavorite ? "移出收藏" : "加入收藏"}
                onClick={() => {
                  onToggleFavorite();
                  showToast(isFavorite ? "已移出收藏" : "已加入收藏");
                }}
                type="button"
              >
                <span className="desktop-label">{isFavorite ? "移出收藏" : "收藏"}</span>
                <span className="mobile-icon">♥</span>
              </button>
            )}
            <button
              aria-label="复制完整设定"
              className="ghost-button preview-action-button"
              data-tooltip="复制"
              onClick={() =>
                copyText(buildFullCharacterText(character), "完整角色设定已复制")
              }
              type="button"
            >
              <span className="desktop-label">复制完整设定</span>
              <span className="mobile-icon">⧉</span>
            </button>
            <button
              aria-label="导出"
              className="ghost-button preview-action-button"
              data-tooltip="导出"
              disabled={loadingAction !== null}
              onClick={() => setIsExportOpen(true)}
              type="button"
            >
              <span className="desktop-label">{loadingAction ? "导出中..." : "导出"}</span>
              <span className="mobile-icon">{loadingAction ? "…" : "⇩"}</span>
            </button>
            <button
              aria-label="返回"
              className="ghost-button preview-action-button"
              data-tooltip="返回"
              onClick={onBack}
              type="button"
            >
              <span className="desktop-label">返回</span>
              <span className="mobile-icon">←</span>
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
                  <span className={`tag-tone-${getTagTone(tag)}`} key={tag}>{tag}</span>
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

function getTagTone(tag: string) {
  const total = Array.from(tag).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return total % 18;
}

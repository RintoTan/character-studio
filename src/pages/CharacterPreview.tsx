import { useEffect, useRef, useState } from "react";
import { AvatarDisplay } from "../components/AvatarDisplay";
import type { Character } from "../types/character";
import { getAvatarAsset } from "../utils/avatarAssets";
import { exportCharacterJson, exportPreviewImage, exportPreviewPdf } from "../utils/importExport";

type CharacterPreviewProps = {
  character: Character;
  exportSettings?: {
    jpgQuality: number;
    pngScale: number;
    pdfLightMode: boolean;
    includePromptSection: boolean;
    includeTimeInfo: boolean;
  };
  onBack: () => void;
  onEdit?: () => void;
  onToggleFavorite?: () => void;
  exportSignal?: number;
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
    `喜好：${displayValue(character.likes)}`,
    `厌恶：${displayValue(character.dislikes)}`,
    `习惯：${displayValue(character.habits)}`,
    `重要物品：${displayValue(character.importantItems)}`,
    `人际关系关键词：${displayValue(character.relationshipKeywords)}`,
    `中文人物关键词：${displayValue(character.characterKeywords)}`,
    `英文 AI Prompt：${displayValue(character.imagePrompt)}`,
  ].join("\n");
}

export function CharacterPreview({ character, exportSettings, onBack, onEdit, onToggleFavorite, exportSignal = 0 }: CharacterPreviewProps) {
  const [toastMessage, setToastMessage] = useState("");
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState("");
  const previewRef = useRef<HTMLDivElement>(null);
  const exportSignalRef = useRef(exportSignal);
  const isFavorite = Boolean(character.favorite ?? character.isFavorite);

  function showToast(message: string) {
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(""), 3000);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsExportOpen(false);
        closeAvatarPreview();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (exportSignal === exportSignalRef.current) {
      return;
    }

    exportSignalRef.current = exportSignal;
    setIsExportOpen(true);
  }, [exportSignal]);

  async function copyText(text: string, message: string) {
    await navigator.clipboard.writeText(text || "未填写");
    showToast(message);
  }

  async function handleExportJson() {
    setLoadingAction("json");
    try {
      await exportCharacterJson(character);
      showToast("当前角色 JSON 已导出");
    } catch {
      showToast("JSON 导出失败");
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleExportPdf() {
    if (!previewRef.current) {
      showToast("找不到可导出的角色展示区域");
      return;
    }

    setLoadingAction("pdf");

    try {
      await exportPreviewPdf(previewRef.current, character.name || "未命名角色", {
        forceLightMode: exportSettings?.pdfLightMode !== false,
        scale: exportSettings?.pngScale || 2,
      });
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
      await exportPreviewImage(
        previewRef.current,
        character.name || "未命名角色",
        format,
        exportSettings?.jpgQuality || 0.9,
        {
          forceLightMode: exportSettings?.pdfLightMode !== false,
          scale: exportSettings?.pngScale || 2,
        },
      );
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
      void handleExportJson();
      return;
    }

    if (format === "pdf") {
      void handleExportPdf();
      return;
    }

    void handleExportImage(format);
  }

  async function openAvatarPreview() {
    if (!character.avatarAssetId) {
      showToast("当前角色使用 Emoji 头像");
      return;
    }

    try {
      const asset = await getAvatarAsset(character.avatarAssetId);

      if (!asset) {
        showToast("头像图片读取失败，已回退 Emoji");
        return;
      }

      setAvatarPreviewUrl(URL.createObjectURL(asset.blob));
    } catch {
      showToast("头像图片读取失败，已回退 Emoji");
    }
  }

  function closeAvatarPreview() {
    setAvatarPreviewUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return "";
    });
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
      {avatarPreviewUrl && (
        <div
          className="modal-backdrop avatar-preview-backdrop"
          data-pdf-hidden="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeAvatarPreview();
            }
          }}
          role="presentation"
        >
          <div className="avatar-preview-dialog" role="dialog" aria-modal="true">
            <button className="ghost-button" onClick={closeAvatarPreview} type="button">
              关闭
            </button>
            <img alt="" src={avatarPreviewUrl} />
          </div>
        </div>
      )}

      <div ref={previewRef} data-pdf-export-root="true">
        <div className="preview-hero">
          <div className="preview-identity">
            <button
              aria-label="查看头像大图"
              className="preview-avatar-button"
              data-pdf-keep="true"
              onClick={() => void openAvatarPreview()}
              type="button"
            >
              <AvatarDisplay
                assetId={character.avatarAssetId}
                className="preview-avatar"
                emoji={character.avatarEmoji || "🙂"}
              />
            </button>
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
                <span className="mobile-icon">⌁</span>
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
                <span className="mobile-icon">{isFavorite ? "♥" : "♡"}</span>
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
              <span className="mobile-icon">□</span>
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
              <span className="mobile-icon">{loadingAction ? "…" : "↓"}</span>
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

          <article
            className="preview-card wide-card"
            data-pdf-hidden={exportSettings?.includePromptSection === false ? "true" : undefined}
          >
            <div className="preview-card-title">
              <h2>外貌描述</h2>
            </div>
            <p>{displayValue(character.appearanceDescription)}</p>
          </article>

          <article
            className="preview-card wide-card"
            data-pdf-hidden={exportSettings?.includePromptSection === false ? "true" : undefined}
          >
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
              <h2>个人偏好</h2>
            </div>
            <div className="preference-preview-grid">
              <div>
                <span>喜好</span>
                <p>{displayValue(character.likes)}</p>
              </div>
              <div>
                <span>厌恶</span>
                <p>{displayValue(character.dislikes)}</p>
              </div>
              <div>
                <span>习惯</span>
                <p>{displayValue(character.habits)}</p>
              </div>
              <div>
                <span>重要物品</span>
                <p>{displayValue(character.importantItems)}</p>
              </div>
              <div>
                <span>人际关系关键词</span>
                <p>{displayValue(character.relationshipKeywords)}</p>
              </div>
            </div>
          </article>

          <article className="preview-card wide-card">
            <div className="preview-card-title">
              <h2>中文人物关键词</h2>
              <button
                className="ghost-button"
                data-pdf-hidden="true"
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
                data-pdf-hidden="true"
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

          <article
            className="preview-card wide-card preview-time-card"
            data-pdf-hidden={exportSettings?.includeTimeInfo === false ? "true" : undefined}
          >
            <div>
              <span>创建时间</span>
              <strong>{formatPreviewTime(character.createdAt)}</strong>
            </div>
            <div>
              <span>最后编辑</span>
              <strong>{formatPreviewTime(character.updatedAt)}</strong>
            </div>
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

function formatPreviewTime(value?: string) {
  if (!value) {
    return "未知";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "未知";
  }

  const currentYear = new Date().getFullYear();
  const options: Intl.DateTimeFormatOptions =
    date.getFullYear() === currentYear
      ? {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        }
      : {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        };

  return new Intl.DateTimeFormat("en-US", options).format(date);
}

import { useEffect, useRef, useState } from "react";
import { AvatarDisplay } from "../components/AvatarDisplay";
import { Icon } from "../components/Icon";
import type { Character } from "../types/character";
import { getAvatarAsset } from "../utils/avatarAssets";
import { exportCharacterJson, exportPreviewImage, exportPreviewPdf } from "../utils/importExport";
import { getContentCopy } from "../config/developerSettings";
import { CharacterRelatedInfo } from "../components/CharacterRelatedInfo";
import type { Relationship } from "../types/relationship";
import type { TimelineEvent } from "../types/timeline";
import type { WorldEntry } from "../types/world";

/**
 * One screen, two jobs, decided by who opened it.
 *
 * From the dashboard it is a reading page: the character as the author wrote them,
 * plus an export of that character. From the editor it is the last look before
 * saving, so it carries the editor's own actions — save, save as draft, back to
 * editing, delete — and instead of a second 返回 it has exactly one way back.
 *
 * The three copy buttons that used to sit in the cards are still gone: those two
 * fields have a copy button in the editor, and the page is for reading.
 */
type CharacterPreviewProps = {
  character: Character;
  onBack: () => void;
  onEdit?: () => void;
  onToggleFavorite?: () => void;
  mode?: "browse" | "editing";
  onSave?: () => void;
  onSaveDraft?: () => void;
  onDelete?: () => void;
  exportSettings?: {
    jpgQuality: number;
    pngScale: number;
    pdfLightMode: boolean;
    includeFooter: boolean;
    includePromptSection: boolean;
    includeTimeInfo: boolean;
    footerText?: string;
  };
  // What this character is connected to. Supplied by the app shell rather than read
  // here, so the preview never loads a second copy of the workspaces.
  related?: {
    characters: Character[];
    relationships: Relationship[];
    events: TimelineEvent[];
    entries: WorldEntry[];
  };
  onOpenGraph?: () => void;
  onOpenEvent?: (eventId: string) => void;
  onOpenEntry?: (entryId: string) => void;
  onOpenRelatedCharacter?: (characterId: string) => void;
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

export function CharacterPreview({
  character,
  onBack,
  onEdit,
  onToggleFavorite,
  mode = "browse",
  related,
  onOpenGraph,
  onOpenEvent,
  onOpenEntry,
  onOpenRelatedCharacter,
  onSave,
  onSaveDraft,
  onDelete,
  exportSettings,
}: CharacterPreviewProps) {
  const [toastMessage, setToastMessage] = useState("");
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState("");
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const isFavorite = Boolean(character.favorite ?? character.isFavorite);
  const isEditing = mode === "editing";

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
                <p className="eyebrow">导出角色档案</p>
                <h2>选择导出格式</h2>
              </div>
              <button className="ghost-button" onClick={() => setIsExportOpen(false)} type="button">
                关闭
              </button>
            </div>
            <div className="export-dialog-list">
              <button onClick={() => runExport("json")} type="button">
                导出 JSON（角色数据）
              </button>
              <button onClick={() => runExport("pdf")} type="button">
                {loadingAction === "pdf" ? "导出中..." : "导出 PDF（A4 阅读稿）"}
              </button>
              <button onClick={() => runExport("jpg")} type="button">
                {loadingAction === "jpg" ? "导出中..." : "导出 JPG（版面截图）"}
              </button>
              <button onClick={() => runExport("png")} type="button">
                {loadingAction === "png" ? "导出中..." : "导出 PNG（版面截图）"}
              </button>
            </div>
            <p className="muted export-dialog-note">{getContentCopy("exportGuide")}</p>
          </div>
        </div>
      )}
      {avatarPreviewUrl && (
        <div
          className="modal-backdrop avatar-preview-backdrop"
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
          {/* Not in the export: a character sheet has no buttons on it. This also
              keeps html2canvas away from them — `--control-fill` is a color-mix(),
              and a ghost button's computed background comes back as a `color()`
              function that html2canvas cannot parse, which fails the whole capture. */}
          <div className="preview-actions" data-pdf-hidden="true">
            {isEditing ? (
              <>
                {/* The editor's own actions, in the order the editor offers them, and
                    one way back rather than two: this page used to carry 返回 here and
                    返回编辑 on the bar above it. */}
                <button
                  aria-label="返回编辑"
                  className="ghost-button preview-action-button"
                  data-tooltip="返回编辑"
                  onClick={onBack}
                  type="button"
                >
                  <span className="desktop-label">返回编辑</span>
                  <span className="mobile-icon">
                    <Icon name="arrowLeft" size={16} />
                  </span>
                </button>
                <button
                  aria-label="保存草稿"
                  className="ghost-button preview-action-button"
                  data-tooltip="保存草稿"
                  onClick={onSaveDraft}
                  type="button"
                >
                  <span className="desktop-label">保存草稿</span>
                  <span className="mobile-icon">
                    <Icon name="file" size={16} />
                  </span>
                </button>
                <button
                  aria-label="删除角色"
                  className="ghost-button preview-action-button danger"
                  data-tooltip="删除角色"
                  onClick={onDelete}
                  type="button"
                >
                  <span className="desktop-label">删除角色</span>
                  <span className="mobile-icon">
                    <Icon name="trash" size={16} />
                  </span>
                </button>
                <button
                  aria-label="保存角色"
                  className="primary-button preview-action-button"
                  data-tooltip="保存角色"
                  onClick={onSave}
                  type="button"
                >
                  <span className="desktop-label">保存角色</span>
                  <span className="mobile-icon">
                    <Icon name="check" size={16} />
                  </span>
                </button>
              </>
            ) : (
              <>
                {onEdit && (
                  <button
                    aria-label="编辑"
                    className="ghost-button preview-action-button"
                    data-tooltip="编辑"
                    onClick={onEdit}
                    type="button"
                  >
                    <span className="desktop-label">编辑</span>
                    <span className="mobile-icon">
                      <Icon name="pencil" size={16} />
                    </span>
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
                    <span className="mobile-icon">
                      <Icon filled={isFavorite} name="heart" size={16} />
                    </span>
                  </button>
                )}
                <button
                  aria-label="导出"
                  className="ghost-button preview-action-button"
                  data-tooltip="导出"
                  disabled={loadingAction !== null}
                  onClick={() => setIsExportOpen(true)}
                  type="button"
                >
                  <span className="desktop-label">{loadingAction ? "导出中..." : "导出"}</span>
                  <span className="mobile-icon">
                    {loadingAction ? "…" : <Icon name="download" size={16} />}
                  </span>
                </button>
                <button
                  aria-label="返回"
                  className="ghost-button preview-action-button"
                  data-tooltip="返回"
                  onClick={onBack}
                  type="button"
                >
                  <span className="desktop-label">返回</span>
                  <span className="mobile-icon">
                    <Icon name="arrowLeft" size={16} />
                  </span>
                </button>
              </>
            )}
          </div>
        </div>

        <div className="preview-layout">
          <article className="preview-card basic-card">
            <div className="preview-card-title">
              <h2>基础资料</h2>
            </div>
            <div className="basic-grid">
              {basicFields.map(([key, label]) => {
                // An unfilled field is still worth stating, but not at the weight of
                // a filled one: the row marks which fields are empty instead of
                // giving every unset value a panel of its own.
                const value = displayValue(character[key] as string);
                return (
                  <div
                    className={value === "未填写" ? "basic-item is-empty" : "basic-item"}
                    key={key}
                  >
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                );
              })}
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
            </div>
            <p>{displayValue(character.characterKeywords)}</p>
          </article>

          <article className="preview-card wide-card">
            <div className="preview-card-title">
              <h2>英文 AI Prompt</h2>
            </div>
            <p>{displayValue(character.imagePrompt)}</p>
          </article>

          <article className="preview-card wide-card preview-time-card">
            <div>
              <span>创建时间</span>
              <strong>{formatPreviewTime(character.createdAt)}</strong>
            </div>
            <div>
              <span>最后编辑</span>
              <strong>{formatPreviewTime(character.updatedAt)}</strong>
            </div>
          </article>

          {/* Browsing content, so it renders before the page's footer and is removed
              from the capture: a PDF/JPG/PNG still holds exactly the character. */}
          {related && (
            <div className="preview-related-holder" data-pdf-hidden="true">
              <CharacterRelatedInfo
                character={character}
                characters={related.characters}
                entries={related.entries}
                events={related.events}
                onOpenCharacter={onOpenRelatedCharacter ?? (() => {})}
                onOpenEntry={onOpenEntry ?? (() => {})}
                onOpenEvent={onOpenEvent ?? (() => {})}
                onOpenGraph={onOpenGraph ?? (() => {})}
                relationships={related.relationships}
              />
            </div>
          )}

          {/* Kept in the capture root for the export, and out of the page on screen: the
              app has one footer, at the end of everything. */}
          <div className="preview-export-footer">
            Character Studio · {getContentCopy("footerText")}
          </div>
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

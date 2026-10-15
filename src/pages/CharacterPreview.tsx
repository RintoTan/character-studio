import { useEffect, useState } from "react";
import { AvatarDisplay } from "../components/AvatarDisplay";
import { Icon } from "../components/Icon";
import type { Character } from "../types/character";
import { getAvatarAsset } from "../utils/avatarAssets";
import { getContentCopy } from "../config/developerSettings";

// This screen is what the workspace shows behind 「预览」, and it is read-only on
// purpose. It used to carry its own export menu (JSON/PDF/JPG/PNG) and three copy
// buttons, on top of the exports the dashboard already offers and the copy buttons
// the editor already has — the same four formats and the same two fields, in the
// third place. They are gone: one screen, one job. The data attributes that only
// existed so the export capture could hide parts of this page went with them.
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

export function CharacterPreview({ character, onBack, onEdit, onToggleFavorite }: CharacterPreviewProps) {
  const [toastMessage, setToastMessage] = useState("");
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState("");
  const isFavorite = Boolean(character.favorite ?? character.isFavorite);

  function showToast(message: string) {
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(""), 3000);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
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

  return (
    <section className="preview-page">
      {toastMessage && <div className="toast">{toastMessage}</div>}
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

      <div>
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
          <div className="preview-actions">
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

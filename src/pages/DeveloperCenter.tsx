import type { ReactNode } from "react";
import { Icon, type IconName } from "../components/Icon";
import {
  defaultDeveloperSettings,
  unwiredContentKeys,
  unwiredExportDefaultKeys,
  type DeveloperSettings,
} from "../config/developerSettings";
import externalInspirationLibraryRaw from "../data/external-inspiration-library.txt?raw";
import type { Page, ThemeMode } from "../types/app";
import type { Character } from "../types/character";
import { formatAssetSize } from "../utils/avatarAssets";

type DeveloperSection = {
  id: string;
  icon: IconName;
  title: string;
  subtitle: string;
  description: string;
  items: string[];
};

const developerSections: DeveloperSection[] = [
  {
    id: "project",
    icon: "chart",
    title: "Project",
    subtitle: "项目",
    description: "维护版本、发布信息、项目状态和核心链接。",
    items: ["Version", "Sprint", "Build", "Release Label", "Storage Usage", "GitHub", "Developer Handbook"],
  },
  {
    id: "brand",
    icon: "image",
    title: "品牌资源",
    subtitle: "Brand Assets",
    description: "统一管理 Logo、图标、Favicon、默认头像等品牌资产入口。",
    items: ["Logo", "Dark Logo", "Light Logo", "SVG Logo", "PNG Logo", "Favicon", "App Icon", "PWA Icon", "Emoji 默认资源"],
  },
  {
    id: "design",
    icon: "component",
    title: "设计系统",
    subtitle: "Design System",
    description: "维护 Theme、Radius、Typography、Motion 与真实组件预览。",
    items: ["颜色", "字体", "字号", "圆角", "边框", "阴影", "动画", "间距", "Button", "Card", "Dialog", "Input", "Tag", "Badge", "Switch", "Checkbox", "Radio"],
  },
  {
    id: "content",
    icon: "file",
    title: "内容中心",
    subtitle: "Content",
    description: "维护 About、首次 About、Footer、导入导出说明和基础项目文案。",
    items: ["About", "First About", "Footer", "Settings", "Import Guide", "Export Guide", "Dialog", "Toast", "Privacy", "License"],
  },
  {
    id: "prompt",
    icon: "sparkles",
    title: "Prompt 中心",
    subtitle: "Prompt Center",
    description: "管理随机灵感、示例、写作提示和外挂词库的未来入口。",
    items: ["随机灵感", "示例", "写作提示", "Prompt 模板", "外挂词库", "Prompt Library", "未来 Prompt 编辑器", "external-inspiration-library.txt"],
  },
  {
    id: "application",
    icon: "gear",
    title: "应用配置",
    subtitle: "Application",
    description: "维护页面标题、Footer、Theme、About、Editor 和 Dashboard 默认行为。",
    items: ["页面标题", "Footer", "Theme", "Language", "Version", "About", "Editor", "Dashboard"],
  },
  {
    id: "export",
    icon: "package",
    title: "Export",
    subtitle: "导出规则",
    description: "维护 Preview Export、PDF、PNG、JPG、JSON、CSV、ZIP 的默认规则。",
    items: ["PDF", "PNG", "JPG", "JSON", "CSV", "ZIP", "Prompt", "Footer", "Time", "Metadata"],
  },
  {
    id: "tools",
    icon: "tool",
    title: "Developer Tools",
    subtitle: "开发工具",
    description: "执行低风险维护工具、导出配置、查看存储和打开素材库。",
    items: ["Reset Developer Settings", "Export Config", "Import Config", "View Storage", "Open Asset Library", "Copy Debug Info"],
  },
  {
    id: "experimental",
    icon: "beaker",
    title: "Experimental",
    subtitle: "实验功能",
    description: "收纳未来路线，明确标记 Planned / Coming Soon / In Progress。",
    items: ["Timeline", "Relationship", "Map", "Faction", "World Manager", "Prompt Editor", "AI Prompt V2", "AI Character", "AI Translate", "Workflow"],
  },
];

type DeveloperCenterProps = {
  characters: Character[];
  avatarAssetStats: { count: number; size: number };
  themeMode: ThemeMode;
  currentPage: Page;
  onOpenAssetLibrary: () => void;
  settings: DeveloperSettings;
  onSettingsChange: (settings: DeveloperSettings) => void;
  onResetModule: (module: keyof DeveloperSettings) => void;
  onResetAll: () => void;
  onResetFirstAbout: () => void;
  onExportCharactersJson: () => void;
  onExportFullBackup: () => void;
};

const editorSettingLabels: Record<keyof DeveloperSettings["editorDefaults"], string> = {
  expandAllSections: "默认展开全部 Section",
  collapseAllSections: "默认折叠全部 Section",
  autoSave: "默认启用自动保存",
  showPromptSection: "显示 AI Prompt 区",
  showPersonalPreferences: "显示个人偏好字段",
  compactMobileEditor: "小屏紧凑模式",
};

const editorSettingDescriptions: Record<keyof DeveloperSettings["editorDefaults"], string> = {
  expandAllSections: "新进入编辑页时展开所有可折叠模块。",
  collapseAllSections: "新进入编辑页时折叠所有非基础模块。",
  autoSave: "草稿角色停止输入后自动保存。",
  showPromptSection: "控制编辑页 AI Prompt 模块是否显示。",
  showPersonalPreferences: "控制编辑页个人偏好模块是否显示。",
  compactMobileEditor: "控制移动端编辑页是否启用紧凑样式。",
};

const dashboardSettingLabels: Record<
  keyof Pick<DeveloperSettings["dashboardDefaults"], "showDraftCount" | "showFavoriteCount" | "showUpdatedTime">,
  string
> = {
  showDraftCount: "显示草稿数量",
  showFavoriteCount: "显示收藏数量",
  showUpdatedTime: "显示角色更新时间",
};

const exportSettingLabels: Record<
  keyof Pick<DeveloperSettings["exportDefaults"], "pdfLightMode" | "includeFooter" | "includePromptSection" | "includeTimeInfo">,
  string
> = {
  pdfLightMode: "PDF Light Mode",
  includeFooter: "导出 Footer",
  includePromptSection: "导出 Prompt 区",
  includeTimeInfo: "导出时间信息",
};

const featureFlagLabels: Record<keyof DeveloperSettings["featureFlags"], string> = {
  developerCenter: "Developer Center",
  aiSettings: "AI Settings",
  promptCenter: "Prompt Center",
  assetLibrary: "Asset Library",
  personalPreferences: "Personal Preferences",
  compactMobileEditor: "Compact Mobile Editor",
  experimentalTimeline: "Experimental Timeline",
  experimentalRelationshipGraph: "Experimental Relationship Graph",
  worldManager: "World Manager",
};

// Flags whose module actually exists and reads the value. Anything absent here
// renders as "暂未应用" and is disabled, so the panel never advertises a switch
// that does nothing. compactMobileEditor was removed from this list: it only
// writes a data-compact-mobile-editor attribute and styles.css never reads it.
const appliedFeatureFlags = new Set<keyof DeveloperSettings["featureFlags"]>([
  "aiSettings",
  "promptCenter",
  "assetLibrary",
  "personalPreferences",
  "experimentalRelationshipGraph",
  "experimentalTimeline",
  "worldManager",
]);

type DeveloperFieldStatus = "applied" | "comingSoon" | "readonly";

function DeveloperStatusBadge({ status }: { status: DeveloperFieldStatus }) {
  const labelMap: Record<DeveloperFieldStatus, string> = {
    applied: "已应用",
    comingSoon: "暂未应用",
    readonly: "只读",
  };

  return <span className={`developer-status-badge ${status}`}>{labelMap[status]}</span>;
}

function ComingSoonNote() {
  return <span className="developer-coming-soon">Coming Soon · 当前仅展示，暂未应用</span>;
}

function getLocalStorageFootprint() {
  let total = 0;

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index) || "";
    total += key.length + (localStorage.getItem(key)?.length || 0);
  }

  return total;
}

function getSafeStorageStatus() {
  try {
    const key = "__character_studio_storage_check__";
    localStorage.setItem(key, "1");
    localStorage.removeItem(key);
    return "可用";
  } catch {
    return "不可用";
  }
}

function getPromptLibraryStats() {
  const lines = externalInspirationLibraryRaw
    .split(/\r?\n/)
    .filter((line) => line.trim()).length;
  const size = new Blob([externalInspirationLibraryRaw]).size;

  return { lines, size };
}

const brandLogoSvgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 566.43 637.56"><polygon fill="#222937" points="0 163.51 283.22 0 476.31 111.48 386.19 163.51 283.22 104.06 90.12 215.55 90.12 438.51 254.62 533.49 254.62 637.56 0 490.54 0 163.51"/><polygon fill="#635ab2" points="311.79 533.49 476.31 438.51 476.31 215.55 566.43 163.51 566.43 490.54 311.79 637.56 311.79 533.49"/></svg>`;

function downloadTextFile(content: string, fileName: string, mimeType = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function DeveloperField({
  title,
  description,
  children,
  status = "applied",
}: {
  title: string;
  description: string;
  children: ReactNode;
  status?: DeveloperFieldStatus;
}) {
  return (
    <label className={status === "comingSoon" ? "developer-setting-field coming-soon" : "developer-setting-field"}>
      <span className="developer-setting-copy">
        <span className="developer-setting-title">
          <strong>{title}</strong>
          <DeveloperStatusBadge status={status} />
        </span>
        <small>{description}</small>
        {status === "comingSoon" && <ComingSoonNote />}
      </span>
      <span className="developer-setting-control">{children}</span>
    </label>
  );
}

function DeveloperSwitch({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      aria-checked={checked}
      className={checked ? "developer-switch active" : "developer-switch"}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span />
    </button>
  );
}

export function DeveloperCenter({
  characters,
  avatarAssetStats,
  themeMode,
  currentPage,
  onOpenAssetLibrary,
  settings,
  onSettingsChange,
  onResetModule,
  onResetAll,
  onResetFirstAbout,
  onExportCharactersJson,
  onExportFullBackup,
}: DeveloperCenterProps) {
  const formalCharacters = characters.filter((character) => !character.isDraft).length;
  const draftCharacters = characters.filter((character) => character.isDraft).length;
  const favoriteCharacters = characters.filter((character) => character.favorite || character.isFavorite).length;
  const usedAvatarAssetIds = new Set(
    characters
      .map((character) => character.avatarAssetId)
      .filter((id): id is string => Boolean(id)),
  );
  const avatarBindings = usedAvatarAssetIds.size;
  const unboundAvatarAssets = Math.max(avatarAssetStats.count - avatarBindings, 0);
  const localStorageSize = getLocalStorageFootprint();
  const promptStats = getPromptLibraryStats();
  const indexedDbStatus = typeof indexedDB === "undefined" ? "不可用" : "可用";
  function updateDeveloperModule<T extends keyof DeveloperSettings>(
    module: T,
    value: Partial<DeveloperSettings[T]>,
  ) {
    onSettingsChange({
      ...settings,
      [module]: {
        ...settings[module],
        ...value,
      },
    });
  }

  const appConfig = [
    ["默认主题", themeMode],
    ["默认视图", settings.dashboardDefaults.viewMode],
    ["JPG 导出质量", String(settings.exportDefaults.jpgQuality)],
    ["PDF Light Mode", settings.exportDefaults.pdfLightMode ? "开启" : "关闭"],
    ["小屏简洁模式", settings.editorDefaults.compactMobileEditor ? "开启" : "关闭"],
  ];
  const designComponents = [
    ["Primary Button", "主要按钮", <button className="primary-button" type="button">保存</button>, "用于主要确认与提交。"],
    ["Secondary Button", "次级按钮", <button className="ghost-button" type="button">取消</button>, "用于辅助操作。"],
    ["Card", "卡片", <div className="developer-mini-card">Card Preview</div>, "承载分组信息。"],
    ["Dialog", "弹窗", <div className="developer-mini-dialog">Dialog</div>, "用于确认、预览和设置。"],
    ["Input", "输入框", <input aria-hidden="true" readOnly tabIndex={-1} value="Character Studio" />, "用于文本录入。"],
    ["Select", "选择器", <select aria-hidden="true" defaultValue="light" tabIndex={-1}><option value="light">Light</option></select>, "用于有限选项选择。"],
    ["Tag", "标签", <span className="tag-button selected">冷静</span>, "用于性格标签。"],
    ["Badge", "徽章", <span className="status-badge">Active</span>, "用于状态信息。"],
    ["Switch", "开关", <span className="switch-control active" aria-hidden="true"><span /></span>, "用于开关型设置。"],
    ["Checkbox", "复选", <span className="checkbox-control checked" aria-hidden="true"><Icon name="check" size={13} /></span>, "用于多选与确认。"],
    ["Radio", "单选", <span className="radio-control checked" aria-hidden="true"><span /></span>, "用于导入导出方式选择。"],
  ];
  const contentCards = [
    ["About", "项目介绍、功能说明、路线图与版权信息。"],
    ["首次 About", "首次进入时的轻量欢迎页与上手说明。"],
    ["Settings", "普通用户设置、AI 设置、导入导出与数据说明。"],
    ["Footer", "About、头像素材库、Settings 与版权入口。"],
    ["导入说明", "解释 JSON、ZIP、头像素材与导入确认流程。"],
    ["导出说明", "解释轻量 JSON、完整备份 ZIP、CSV 与展示导出。"],
    ["Toast", "成功、失败、警告、加载等即时反馈。"],
    ["Dialog", "确认、导入预览、素材库、设置等弹窗文案。"],
  ];
  // Statuses describe what ships today. Anything listed as Planned has no screen yet;
  // features that did land (relationship graph, timeline, world manager) live in 已完成
  // so this list cannot quietly contradict the app's own navigation.
  const experiments = [
    ["关系网", "Shipped"],
    ["时间线", "Shipped"],
    ["世界观管理", "Shipped"],
    ["阵营系统", "Planned"],
    ["地图", "Planned"],
    ["大世界时间", "Planned"],
    ["AI 创作辅助", "Planned"],
    ["Prompt 编辑器", "Coming Soon"],
    ["词库编辑器", "Coming Soon"],
  ];

  return (
    <section className="developer-page">
      <div className="panel developer-hero">
        <div>
          <p className="eyebrow">Developer Center</p>
          <h1>开发者中心</h1>
          <p className="muted">Character Studio 项目开发控制中心</p>
        </div>
        <div className="developer-hero-badges">
          {settings.application.showVersion && <span className="status-badge">Version {settings.project.version}</span>}
          {settings.application.showSprint && <span className="status-badge">Sprint {settings.project.sprint}</span>}
          {settings.application.showBuild && <span className="status-badge">Build {settings.project.build}</span>}
          <span className="status-badge">Theme：{themeMode}</span>
          <span className="status-badge">数据版本：Local v1</span>
          <span className="status-badge">Prompt Library：external-inspiration-library.txt</span>
          <a href="https://github.com/RintoTan/character-studio" rel="noreferrer" target="_blank">GitHub</a>
          <a href="https://github.com/RintoTan/character-studio/blob/main/Developer%20Handbook.md" rel="noreferrer" target="_blank">Developer Handbook</a>
        </div>
      </div>

      <div className="developer-layout">
        <aside className="developer-nav" aria-label="Developer Center 导航">
          {developerSections.map((section) => (
            <a href={`#developer-${section.id}`} key={section.id}>
              <Icon name={section.icon} size={18} />
              <strong>{section.title}</strong>
              <small>{section.subtitle}</small>
            </a>
          ))}
        </aside>

        <div className="developer-content">
          <article className="developer-card overview-card" id="developer-project">
            <div className="developer-card-title">
              <Icon name="chart" size={20} />
              <div>
                <h2>Project</h2>
                <p>项目</p>
              </div>
            </div>
            <svg className="developer-logo" aria-hidden="true" viewBox="0 0 566.43 637.56">
              <polygon className="brand-mark-primary" points="0 163.51 283.22 0 476.31 111.48 386.19 163.51 283.22 104.06 90.12 215.55 90.12 438.51 254.62 533.49 254.62 637.56 0 490.54 0 163.51" />
              <polygon className="brand-mark-accent" points="311.79 533.49 476.31 438.51 476.31 215.55 566.43 163.51 566.43 490.54 311.79 637.56 311.79 533.49" />
            </svg>
            <div className="developer-stat-grid">
              <span><strong>Version</strong>{settings.project.version}</span>
              <span><strong>Sprint</strong>{settings.project.sprint}</span>
              <span><strong>Build</strong>{settings.project.build}</span>
              <span><strong>当前主题</strong>{themeMode}</span>
              <span><strong>数据版本</strong>Local v1</span>
              <span><strong>Prompt Library</strong>external-inspiration-library.txt</span>
              <span><strong>Release Label</strong>{settings.project.releaseLabel}</span>
              <span><strong>角色数量</strong>{characters.length}</span>
              <span><strong>草稿数量</strong>{draftCharacters}</span>
              <span><strong>头像素材</strong>{avatarAssetStats.count}</span>
              <span><strong>localStorage</strong>{getSafeStorageStatus()} · {formatAssetSize(localStorageSize)}</span>
              <span><strong>IndexedDB</strong>{indexedDbStatus} · {formatAssetSize(avatarAssetStats.size)}</span>
            </div>
            <div className="developer-link-row">
              <a href="https://github.com/RintoTan/character-studio" rel="noreferrer" target="_blank">GitHub 项目仓库</a>
              <a href="https://github.com/RintoTan/character-studio/blob/main/Developer%20Handbook.md" rel="noreferrer" target="_blank">Developer Handbook</a>
            </div>
            <div className="developer-settings-grid">
              <DeveloperField status="readonly" title="Version" description="统一控制 About、首次 About 与 Developer Center 的版本显示。">
                <input
                  readOnly
                  value={settings.project.version}
                  onChange={(event) => updateDeveloperModule("project", { version: event.target.value })}
                />
              </DeveloperField>
              <DeveloperField status="readonly" title="Sprint" description="统一控制当前 Sprint 标识。">
                <input
                  readOnly
                  value={settings.project.sprint}
                  onChange={(event) => updateDeveloperModule("project", { sprint: event.target.value })}
                />
              </DeveloperField>
              <DeveloperField status="readonly" title="Build" description="统一控制构建年份或构建号显示。">
                <input
                  readOnly
                  value={settings.project.build}
                  onChange={(event) => updateDeveloperModule("project", { build: event.target.value })}
                />
              </DeveloperField>
              <DeveloperField status="readonly" title="Release Label" description="统一控制发布标签。">
                <input
                  readOnly
                  value={settings.project.releaseLabel}
                  onChange={(event) => updateDeveloperModule("project", { releaseLabel: event.target.value })}
                />
              </DeveloperField>
              <DeveloperField status="readonly" title="Release Year" description="统一控制版权与发布年份显示。">
                <input
                  readOnly
                  value={settings.project.releaseYear}
                  onChange={(event) => updateDeveloperModule("project", { releaseYear: event.target.value })}
                />
              </DeveloperField>
            </div>
            <div className="developer-actions-row">
              <button className="ghost-button" onClick={() => onResetModule("project")} type="button">
                恢复默认项目信息
              </button>
              <button className="danger-button" onClick={onResetAll} type="button">
                重置全部 Developer 设置
              </button>
            </div>
          </article>

          {developerSections.filter((section) => section.id !== "project").map((section) => (
            <article className="developer-card" id={`developer-${section.id}`} key={section.id}>
              <div className="developer-card-title">
                <Icon name={section.icon} size={20} />
                <div>
                  <h2>{section.title}</h2>
                  <p>{section.subtitle}</p>
                </div>
              </div>
              <p>{section.description}</p>
              {section.id === "brand" && (
                <>
                  <div className="developer-settings-grid">
                    <DeveloperField title="App Logo" description="控制页面内品牌 Logo 是否显示。">
                      <DeveloperSwitch
                        checked={settings.brandAssets.showAppLogo}
                        onChange={(showAppLogo) => updateDeveloperModule("brandAssets", { showAppLogo })}
                      />
                    </DeveloperField>
                    <DeveloperField title="Header Logo" description="控制 Header 中 Logo 的显示预留。">
                      <DeveloperSwitch
                        checked={settings.brandAssets.showHeaderLogo}
                        onChange={(showHeaderLogo) => updateDeveloperModule("brandAssets", { showHeaderLogo })}
                      />
                    </DeveloperField>
                    <DeveloperField title="About Logo Size" description="控制 About 底部 Logo 的偏好尺寸。">
                      <select
                        value={settings.brandAssets.aboutLogoSize}
                        onChange={(event) =>
                          updateDeveloperModule("brandAssets", {
                            aboutLogoSize: event.target.value as DeveloperSettings["brandAssets"]["aboutLogoSize"],
                          })
                        }
                      >
                        <option value="small">Small</option>
                        <option value="medium">Medium</option>
                        <option value="large">Large</option>
                      </select>
                    </DeveloperField>
                  </div>
                  <div className="developer-brand-grid">
                    {[
                      ["Logo", "src/assets/logo.svg"],
                      ["Dark Logo", "CSS theme token"],
                      ["Light Logo", "CSS theme token"],
                      ["SVG Logo", "public/favicon.svg"],
                      ["Favicon", "public/favicon.svg"],
                      ["App Icon", "public/favicon.svg"],
                      ["PWA Icon", "Coming Soon"],
                    ].map(([label, assetPath]) => (
                      <div className="developer-brand-item" key={label}>
                        <svg aria-hidden="true" viewBox="0 0 566.43 637.56">
                          <polygon className="brand-mark-primary" points="0 163.51 283.22 0 476.31 111.48 386.19 163.51 283.22 104.06 90.12 215.55 90.12 438.51 254.62 533.49 254.62 637.56 0 490.54 0 163.51" />
                          <polygon className="brand-mark-accent" points="311.79 533.49 476.31 438.51 476.31 215.55 566.43 163.51 566.43 490.54 311.79 637.56 311.79 533.49" />
                        </svg>
                        <strong>{label}</strong>
                        <small>{assetPath}</small>
                        <div className="developer-mini-actions">
                          <button className="ghost-button" onClick={() => void navigator.clipboard?.writeText(assetPath)} type="button">
                            复制路径
                          </button>
                          <button
                            className="ghost-button"
                            onClick={() =>
                              label === "SVG Logo"
                                ? downloadTextFile(brandLogoSvgMarkup, "character-studio-logo.svg", "image/svg+xml")
                                : void navigator.clipboard?.writeText(`${label} 暂使用内置资源`)
                            }
                            type="button"
                          >
                            {label === "SVG Logo" ? "导出" : "复制信息"}
                          </button>
                        </div>
                      </div>
                    ))}
                    <div className="developer-brand-item">
                      <span className="developer-emoji-sample">🙂</span>
                      <strong>Emoji fallback</strong>
                      <small>Apple Color Emoji / Segoe UI Emoji / Noto Color Emoji / Twemoji Mozilla</small>
                    </div>
                  </div>
                  <div className="developer-actions-row">
                    <button
                      className="ghost-button"
                      onClick={() => navigator.clipboard?.writeText(brandLogoSvgMarkup)}
                      type="button"
                    >
                      复制 SVG
                    </button>
                    <button className="ghost-button" onClick={() => downloadTextFile(brandLogoSvgMarkup, "character-studio-logo.svg", "image/svg+xml")} type="button">
                      导出 SVG
                    </button>
                    <button className="ghost-button" disabled type="button">
                      上传替换 Coming Soon
                    </button>
                    <button className="ghost-button" onClick={() => onResetModule("brandAssets")} type="button">
                      恢复默认品牌设置
                    </button>
                  </div>
                </>
              )}
              {section.id === "design" && (
                <>
                  <div className="developer-settings-grid">
                    <DeveloperField title="Accent Color" description="控制主要按钮与强调色，实时应用到全站。">
                      <input
                        value={settings.appearance.accentColor}
                        onChange={(event) => updateDeveloperModule("appearance", { accentColor: event.target.value })}
                        type="color"
                      />
                    </DeveloperField>
                    <DeveloperField title="Card Radius" description="控制 Card / Dialog 圆角，实时应用。">
                      <input
                        max="18"
                        min="4"
                        onChange={(event) => updateDeveloperModule("appearance", { cardRadius: Number(event.target.value) })}
                        type="range"
                        value={settings.appearance.cardRadius}
                      />
                    </DeveloperField>
                    <DeveloperField title="Button Radius" description="控制 Button / Icon Button 圆角，实时应用。">
                      <input
                        max="18"
                        min="4"
                        onChange={(event) => updateDeveloperModule("appearance", { buttonRadius: Number(event.target.value) })}
                        type="range"
                        value={settings.appearance.buttonRadius}
                      />
                    </DeveloperField>
                    <DeveloperField title="Input Radius" description="控制 Input / Select / Textarea 圆角，实时应用。">
                      <input
                        max="18"
                        min="4"
                        onChange={(event) => updateDeveloperModule("designTokens", { inputRadius: Number(event.target.value) })}
                        type="range"
                        value={settings.designTokens.inputRadius}
                      />
                    </DeveloperField>
                    <DeveloperField title="Shadow Strength" description="控制 Card / Dialog 等全局阴影强度。">
                      <select
                        value={settings.appearance.shadowStrength}
                        onChange={(event) =>
                          updateDeveloperModule("appearance", {
                            shadowStrength: event.target.value as DeveloperSettings["appearance"]["shadowStrength"],
                          })
                        }
                      >
                        <option value="none">None</option>
                        <option value="soft">Soft</option>
                        <option value="medium">Medium</option>
                        <option value="strong">Strong</option>
                      </select>
                    </DeveloperField>
                    <DeveloperField title="Motion Level" description="控制全局基础动画时长。">
                      <select
                        value={settings.appearance.motionLevel}
                        onChange={(event) =>
                          updateDeveloperModule("appearance", {
                            motionLevel: event.target.value as DeveloperSettings["appearance"]["motionLevel"],
                          })
                        }
                      >
                        <option value="none">None</option>
                        <option value="reduced">Reduced</option>
                        <option value="normal">Normal</option>
                      </select>
                    </DeveloperField>
                    <DeveloperField title="Font Scale" description="控制页面整体字号缩放。">
                      <input
                        max="1.12"
                        min="0.92"
                        onChange={(event) => updateDeveloperModule("appearance", { fontScale: Number(event.target.value) })}
                        step="0.01"
                        type="range"
                        value={settings.appearance.fontScale}
                      />
                    </DeveloperField>
                    <DeveloperField title="Compact UI" description="降低卡片和设置区域间距密度。">
                      <DeveloperSwitch
                        checked={settings.appearance.compactUi}
                        onChange={(compactUi) => updateDeveloperModule("appearance", { compactUi })}
                      />
                    </DeveloperField>
                  </div>
                  <div className="developer-component-grid">
                    {designComponents.map(([englishName, chineseName, preview, description]) => (
                      <div className="developer-component-item" key={String(englishName)}>
                        <div>
                          <strong>{chineseName}</strong>
                          <small>{englishName}</small>
                        </div>
                        <div className="developer-component-preview">{preview}</div>
                        <p>{description}</p>
                      </div>
                    ))}
                  </div>
                  <button
                    className="ghost-button"
                    onClick={() =>
                      onSettingsChange({
                        ...settings,
                        appearance: defaultDeveloperSettings.appearance,
                        designTokens: defaultDeveloperSettings.designTokens,
                      })
                    }
                    type="button"
                  >
                    恢复默认设计参数
                  </button>
                </>
              )}
              {section.id === "content" && (
                <>
                  <div className="developer-settings-grid content-settings-grid">
                    {([
                      ["aboutTitle", "About 标题", "完整 About 中的项目介绍标题。"],
                      ["aboutSummary", "About 摘要", "完整 About 中的项目介绍正文。"],
                      ["firstAboutTagline", "首次 About 标语", "首次欢迎页的产品一句话。"],
                      ["footerText", "Footer 文案", "全局 Footer 默认文案。"],
                      ["settingsSummary", "Settings 说明", "Settings 模块说明文案。"],
                      ["importGuide", "导入说明", "导入 JSON / ZIP 的用户说明。"],
                      ["exportGuide", "导出说明", "导出 JSON / ZIP / 展示格式的用户说明。"],
                      ["dialogCopy", "Dialog 说明", "统一弹窗交互说明。"],
                      ["toastCopy", "Toast 说明", "统一 Toast 反馈说明。"],
                      ["privacy", "Privacy", "本地数据与隐私说明。"],
                      ["license", "License", "版权与授权说明。"],
                    ] as Array<[keyof DeveloperSettings["content"], string, string]>).map(([key, title, description]) => (
                      <DeveloperField
                        key={key}
                        title={title}
                        description={description}
                        status={unwiredContentKeys.has(key) ? "comingSoon" : "applied"}
                      >
                        <textarea
                          value={settings.content[key]}
                          onChange={(event) => {
                            if (key === "footerText") {
                              onSettingsChange({
                                ...settings,
                                content: {
                                  ...settings.content,
                                  footerText: event.target.value,
                                },
                                application: {
                                  ...settings.application,
                                  footerText: event.target.value,
                                },
                              });
                              return;
                            }

                            updateDeveloperModule("content", { [key]: event.target.value });
                          }}
                        />
                      </DeveloperField>
                    ))}
                  </div>
                  <div className="developer-actions-row">
                    <button
                      className="ghost-button"
                      onClick={() => void navigator.clipboard?.writeText(JSON.stringify(settings.content, null, 2))}
                      type="button"
                    >
                      复制 Content JSON
                    </button>
                    <button className="ghost-button" onClick={() => onResetModule("content")} type="button">
                      恢复默认内容
                    </button>
                  </div>
                  <div className="developer-readonly-grid">
                    {contentCards.map(([title, description]) => (
                      <span key={title}><strong>{title}</strong>{description}</span>
                    ))}
                  </div>
                </>
              )}
              {section.id === "prompt" && !settings.featureFlags.promptCenter && (
                <div className="developer-readonly-grid">
                  <span><strong>Prompt Center</strong><ComingSoonNote /></span>
                  <span><strong>说明</strong>该模块已由 Feature Flag 暂停显示，随机系统继续使用当前已保存配置。</span>
                </div>
              )}
              {section.id === "prompt" && settings.featureFlags.promptCenter && (
                <>
                  <div className="developer-settings-grid">
                    <DeveloperField title="启用外挂词库" description="控制随机灵感是否优先使用外部词库。">
                      <DeveloperSwitch
                        checked={settings.promptCenter.externalLibraryEnabled}
                        onChange={(externalLibraryEnabled) => updateDeveloperModule("promptCenter", { externalLibraryEnabled })}
                      />
                    </DeveloperField>
                    <DeveloperField title="随机缺失字段" description="控制随机角色生成时是否允许部分字段留白。">
                      <DeveloperSwitch
                        checked={settings.promptCenter.randomMissingFields}
                        onChange={(randomMissingFields) => updateDeveloperModule("promptCenter", { randomMissingFields })}
                      />
                    </DeveloperField>
                    <DeveloperField title="随机复杂度" description="影响随机灵感组合密度。">
                      <select
                        value={settings.promptCenter.complexity}
                        onChange={(event) =>
                          updateDeveloperModule("promptCenter", {
                            complexity: event.target.value as DeveloperSettings["promptCenter"]["complexity"],
                          })
                        }
                      >
                        <option value="low">低</option>
                        <option value="medium">中</option>
                        <option value="high">高</option>
                      </select>
                    </DeveloperField>
                    <DeveloperField title="重复控制" description="控制随机灵感短期重复规避强度。">
                      <select
                        value={settings.promptCenter.repeatControl}
                        onChange={(event) =>
                          updateDeveloperModule("promptCenter", {
                            repeatControl: event.target.value as DeveloperSettings["promptCenter"]["repeatControl"],
                          })
                        }
                      >
                        <option value="off">关闭</option>
                        <option value="normal">普通</option>
                        <option value="strict">严格</option>
                      </select>
                    </DeveloperField>
                    <DeveloperField title="自定义 Prompt Library" description="追加本地词库，使用与 external-inspiration-library.txt 相同格式。">
                      <textarea
                        placeholder="// ===== shared.symbols&#10;&quot;一枚旧戒指&quot;,"
                        value={settings.promptCenter.customLibraryText}
                        onChange={(event) => updateDeveloperModule("promptCenter", { customLibraryText: event.target.value })}
                      />
                    </DeveloperField>
                  </div>
                  <div className="developer-stat-grid compact">
                    <span><strong>当前词库</strong>external-inspiration-library.txt</span>
                    <span><strong>接入状态</strong>{settings.promptCenter.externalLibraryEnabled ? "已启用" : "已停用"}</span>
                    <span><strong>用途</strong>随机灵感、示例、写作提示、随机角色生成</span>
                    <span><strong>行数</strong>{promptStats.lines}</span>
                    <span><strong>文本大小</strong>{formatAssetSize(promptStats.size)}</span>
                    <span><strong>未来能力</strong>词库编辑器、Prompt 模板、导入导出</span>
                  </div>
                  <button className="ghost-button" onClick={() => onResetModule("promptCenter")} type="button">
                    恢复默认 Prompt 设置
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => downloadTextFile(settings.promptCenter.customLibraryText, "character-studio-custom-prompt-library.txt")}
                    type="button"
                  >
                    导出自定义词库
                  </button>
                  <button className="ghost-button" disabled type="button">
                    文件导入 Coming Soon
                  </button>
                </>
              )}
              {section.id === "application" && (
                <>
                  <div className="developer-settings-grid">
                    <DeveloperField title="默认页面标题" description="立即同步到浏览器标题。">
                      <input
                        value={settings.application.pageTitle}
                        onChange={(event) => updateDeveloperModule("application", { pageTitle: event.target.value })}
                      />
                    </DeveloperField>
                    <DeveloperField title="默认 Footer 文案" description="控制 App/Footer 默认显示文案。">
                      <input
                        value={settings.application.footerText}
                        onChange={(event) => updateDeveloperModule("application", { footerText: event.target.value })}
                      />
                    </DeveloperField>
                    <DeveloperField title="语言显示方式" description="未来用于全局文案展示策略，当前暂未接入。" status="comingSoon">
                      <select
                        disabled
                        value={settings.application.languageMode}
                        onChange={(event) =>
                          updateDeveloperModule("application", {
                            languageMode: event.target.value as DeveloperSettings["application"]["languageMode"],
                          })
                        }
                      >
                        <option value="zh">中文</option>
                        <option value="bilingual">中英对照</option>
                      </select>
                    </DeveloperField>
                    <DeveloperField title="首次显示 About" description="控制下次新环境是否自动展示首次 About。">
                      <DeveloperSwitch
                        checked={settings.application.showFirstAbout}
                        onChange={(showFirstAbout) => updateDeveloperModule("application", { showFirstAbout })}
                      />
                    </DeveloperField>
                    {(["showVersion", "showSprint", "showBuild"] as const).map((key) => (
                      <DeveloperField key={key} title={key} description="控制版本信息显示偏好。">
                        <DeveloperSwitch
                          checked={settings.application[key]}
                          onChange={(value) => updateDeveloperModule("application", { [key]: value })}
                        />
                      </DeveloperField>
                    ))}
                  </div>
                  <div className="developer-actions-row">
                    <button className="ghost-button" onClick={onResetFirstAbout} type="button">
                      重置首次 About 显示状态
                    </button>
                    <button className="ghost-button" onClick={() => onResetModule("application")} type="button">
                      恢复默认应用配置
                    </button>
                  </div>
                  <h3 className="developer-subtitle">Editor / 编辑页默认行为</h3>
                  <div className="developer-settings-grid">
                    {(Object.entries(settings.editorDefaults) as Array<[keyof DeveloperSettings["editorDefaults"], boolean]>).map(([key, value]) => (
                      <DeveloperField key={key} title={editorSettingLabels[key]} description={editorSettingDescriptions[key]}>
                        <DeveloperSwitch
                          checked={Boolean(value)}
                          onChange={(nextValue) =>
                            updateDeveloperModule("editorDefaults", {
                              [key]: nextValue,
                            } as Partial<DeveloperSettings["editorDefaults"]>)
                          }
                        />
                      </DeveloperField>
                    ))}
                  </div>
                  <h3 className="developer-subtitle">Dashboard / 主页默认行为</h3>
                  <div className="developer-settings-grid">
                    <DeveloperField title="默认视图" description="卡片 / 列表，写入现有 Dashboard 偏好。">
                      <select
                        value={settings.dashboardDefaults.viewMode}
                        onChange={(event) =>
                          updateDeveloperModule("dashboardDefaults", {
                            viewMode: event.target.value as DeveloperSettings["dashboardDefaults"]["viewMode"],
                          })
                        }
                      >
                        <option value="cards">卡片</option>
                        <option value="list">列表</option>
                      </select>
                    </DeveloperField>
                    <DeveloperField title="默认排序" description="写入现有 Dashboard 偏好。">
                      <select
                        value={settings.dashboardDefaults.sortMode}
                        onChange={(event) =>
                          updateDeveloperModule("dashboardDefaults", {
                            sortMode: event.target.value as DeveloperSettings["dashboardDefaults"]["sortMode"],
                          })
                        }
                      >
                        <option value="updated-desc">最近编辑</option>
                        <option value="created-desc">最近创建</option>
                        <option value="name-asc">名称 A-Z</option>
                        <option value="name-desc">名称 Z-A</option>
                      </select>
                    </DeveloperField>
                    <DeveloperField title="卡片标签数量" description="控制 Dashboard 卡片最多展示多少个性格标签。">
                      <input
                        max="8"
                        min="0"
                        onChange={(event) => updateDeveloperModule("dashboardDefaults", { cardTagCount: Number(event.target.value) })}
                        type="number"
                        value={settings.dashboardDefaults.cardTagCount}
                      />
                    </DeveloperField>
                    {(["showDraftCount", "showFavoriteCount", "showUpdatedTime"] as const).map((key) => (
                      <DeveloperField key={key} title={dashboardSettingLabels[key]} description="Dashboard 信息显示偏好，实时应用。">
                        <DeveloperSwitch
                          checked={settings.dashboardDefaults[key]}
                          onChange={(value) => updateDeveloperModule("dashboardDefaults", { [key]: value })}
                        />
                      </DeveloperField>
                    ))}
                  </div>
                  <div className="developer-stat-grid compact">
                    {appConfig.map(([label, value]) => (
                      <span key={label}><strong>{label}</strong>{value}</span>
                    ))}
                  </div>
                </>
              )}
              {section.id === "export" && (
                <>
                  <div className="developer-settings-grid">
                    <DeveloperField title="JPG 默认质量" description="控制 Preview JPG 导出的压缩质量。">
                      <input
                        max="1"
                        min="0.1"
                        onChange={(event) => updateDeveloperModule("exportDefaults", { jpgQuality: Number(event.target.value) })}
                        step="0.1"
                        type="number"
                        value={settings.exportDefaults.jpgQuality}
                      />
                    </DeveloperField>
                    <DeveloperField title="PNG / PDF 截图倍率" description="控制 Preview 图片与 PDF 截图倍率，实时应用。">
                      <input
                        max="4"
                        min="1"
                        onChange={(event) => updateDeveloperModule("exportDefaults", { pngScale: Number(event.target.value) })}
                        step="1"
                        type="number"
                        value={settings.exportDefaults.pngScale}
                      />
                    </DeveloperField>
                    {(["pdfLightMode", "includeFooter", "includePromptSection", "includeTimeInfo"] as const).map((key) => {
                      // Three of these four are stored and editable and read by nothing:
                      // the PDF footer, the prompt block and the timestamp are fixed.
                      // They keep their switch so the stored value stays visible, but the
                      // badge tells the truth and the control does not pretend to work.
                      const wired = !unwiredExportDefaultKeys.has(key);
                      return (
                        <DeveloperField
                          key={key}
                          title={exportSettingLabels[key]}
                          description={
                            wired
                              ? "控制 Preview 展示导出是否使用浅色背景，实时应用。"
                              : "该导出规则当前保持固定，后续提供可视化配置。"
                          }
                          status={wired ? "applied" : "comingSoon"}
                        >
                          <DeveloperSwitch
                            checked={settings.exportDefaults[key]}
                            disabled={!wired}
                            onChange={(value) => updateDeveloperModule("exportDefaults", { [key]: value })}
                          />
                        </DeveloperField>
                      );
                    })}
                    {(["JSON Metadata", "CSV 字段配置", "ZIP Manifest 策略", "Logo 导出开关", "Version 导出开关"] as const).map((label) => (
                      <DeveloperField key={label} title={label} description="该导出规则当前保持固定，后续提供可视化配置。" status="comingSoon">
                        <button className="ghost-button" disabled type="button">Coming Soon</button>
                      </DeveloperField>
                    ))}
                  </div>
                  <div className="developer-actions-row">
                    <button className="ghost-button" onClick={() => onResetModule("exportDefaults")} type="button">
                      恢复默认导出规则
                    </button>
                  </div>
                </>
              )}
              {section.id === "tools" && (
                <>
                  <div className="developer-stat-grid compact">
                    <span><strong>localStorage</strong>{getSafeStorageStatus()} · {formatAssetSize(localStorageSize)}</span>
                    <span><strong>IndexedDB</strong>{indexedDbStatus} · {formatAssetSize(avatarAssetStats.size)}</span>
                    <span><strong>当前 Theme</strong>{themeMode}</span>
                    <span><strong>当前路由</strong>{currentPage === "developer" ? "/developer" : currentPage}</span>
                    <span><strong>角色数量</strong>{characters.length}</span>
                    <span><strong>正式角色</strong>{formalCharacters}</span>
                    <span><strong>草稿数量</strong>{draftCharacters}</span>
                    <span><strong>收藏数量</strong>{favoriteCharacters}</span>
                    <span><strong>头像素材</strong>{avatarAssetStats.count}</span>
                    <span><strong>已绑定头像</strong>{avatarBindings}</span>
                    <span><strong>未绑定头像</strong>{unboundAvatarAssets}</span>
                    <span><strong>Prompt Library</strong>external-inspiration-library.txt</span>
                  </div>
                  <div className="developer-actions-row">
                    <button className="ghost-button" onClick={onOpenAssetLibrary} type="button">
                      打开头像素材库
                    </button>
                    <button
                      className="ghost-button"
                      onClick={() => void navigator.clipboard?.writeText(JSON.stringify(settings, null, 2))}
                      type="button"
                    >
                      导出 / 复制 Developer Config
                    </button>
                    <button className="ghost-button" onClick={onExportCharactersJson} type="button">
                      导出角色 JSON
                    </button>
                    <button className="ghost-button" onClick={onExportFullBackup} type="button">
                      导出完整备份 ZIP
                    </button>
                    <button
                      className="ghost-button"
                      onClick={() =>
                        void navigator.clipboard?.writeText(
                          JSON.stringify(
                            {
                              page: currentPage,
                              themeMode,
                              localStorage: getSafeStorageStatus(),
                              indexedDB: indexedDbStatus,
                              characterCount: characters.length,
                              avatarAssetStats,
                              settings,
                            },
                            null,
                            2,
                          ),
                        )
                      }
                      type="button"
                    >
                      复制 Debug Info
                    </button>
                    <button className="danger-button" onClick={onResetAll} type="button">
                      Reset Developer Settings
                    </button>
                  </div>
                  <textarea
                    aria-label="开发者配置 JSON 预览"
                    className="developer-json-preview"
                    readOnly
                    value={JSON.stringify(settings, null, 2)}
                  />
                </>
              )}
              {section.id === "experimental" && (
                <>
                  <div className="developer-settings-grid">
                    {(Object.entries(settings.featureFlags) as Array<[keyof DeveloperSettings["featureFlags"], boolean]>).map(([key, value]) => {
                      const isApplied = appliedFeatureFlags.has(key);
                      return (
                      <DeveloperField
                        key={key}
                        title={featureFlagLabels[key]}
                        description={isApplied ? "控制对应模块入口或状态。" : "预留实验能力，当前仅展示规划。"}
                        status={isApplied ? "applied" : "comingSoon"}
                      >
                        <DeveloperSwitch
                          checked={Boolean(value)}
                          disabled={!isApplied}
                          onChange={(nextValue) =>
                            updateDeveloperModule("featureFlags", {
                              [key]: nextValue,
                            } as Partial<DeveloperSettings["featureFlags"]>)
                          }
                        />
                      </DeveloperField>
                      );
                    })}
                  </div>
                  <div className="developer-chip-list status-list">
                    {experiments.map(([name, status]) => (
                      <span key={name}><strong>{name}</strong>{status}</span>
                    ))}
                  </div>
                  <button className="ghost-button" onClick={() => onResetModule("featureFlags")} type="button">
                    恢复默认实验功能
                  </button>
                </>
              )}
              <div className="developer-chip-list">
                {section.items.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

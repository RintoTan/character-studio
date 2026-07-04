export type DeveloperSettings = {
  appearance: {
    accentColor: string;
    borderRadius: number;
    cardRadius: number;
    buttonRadius: number;
    shadowStrength: "none" | "soft" | "medium" | "strong";
    motionLevel: "none" | "reduced" | "normal";
    compactUi: boolean;
    fontScale: number;
  };
  designTokens: {
    inputRadius: number;
    spacingDensity: "compact" | "comfortable" | "spacious";
    animationSpeed: "slow" | "normal" | "fast";
  };
  brandAssets: {
    showAppLogo: boolean;
    showHeaderLogo: boolean;
    aboutLogoSize: "small" | "medium" | "large";
  };
  editorDefaults: {
    expandAllSections: boolean;
    collapseAllSections: boolean;
    autoSave: boolean;
    showPromptSection: boolean;
    showPersonalPreferences: boolean;
    compactMobileEditor: boolean;
  };
  dashboardDefaults: {
    viewMode: "cards" | "list";
    sortMode: "updated-desc" | "created-desc" | "name-asc" | "name-desc";
    cardTagCount: number;
    showDraftCount: boolean;
    showFavoriteCount: boolean;
    showUpdatedTime: boolean;
  };
  exportDefaults: {
    jpgQuality: number;
    pngScale: number;
    pdfLightMode: boolean;
    includeFooter: boolean;
    includePromptSection: boolean;
    includeTimeInfo: boolean;
  };
  promptCenter: {
    externalLibraryEnabled: boolean;
    randomMissingFields: boolean;
    complexity: "low" | "medium" | "high";
    repeatControl: "off" | "normal" | "strict";
  };
  application: {
    pageTitle: string;
    footerText: string;
    languageMode: "zh" | "bilingual";
    showVersion: boolean;
    showSprint: boolean;
    showBuild: boolean;
    showFirstAbout: boolean;
  };
  featureFlags: {
    developerCenter: boolean;
    aiSettings: boolean;
    promptCenter: boolean;
    assetLibrary: boolean;
    personalPreferences: boolean;
    compactMobileEditor: boolean;
    experimentalTimeline: boolean;
    experimentalRelationshipGraph: boolean;
  };
  developerMode: {
    enabled: boolean;
  };
};

export const DEVELOPER_SETTINGS_KEY = "character-studio-developer-settings";

export const defaultDeveloperSettings: DeveloperSettings = {
  appearance: {
    accentColor: "#635ab2",
    borderRadius: 8,
    cardRadius: 8,
    buttonRadius: 8,
    shadowStrength: "soft",
    motionLevel: "normal",
    compactUi: false,
    fontScale: 1,
  },
  designTokens: {
    inputRadius: 8,
    spacingDensity: "comfortable",
    animationSpeed: "normal",
  },
  brandAssets: {
    showAppLogo: true,
    showHeaderLogo: true,
    aboutLogoSize: "large",
  },
  editorDefaults: {
    expandAllSections: false,
    collapseAllSections: false,
    autoSave: true,
    showPromptSection: true,
    showPersonalPreferences: true,
    compactMobileEditor: true,
  },
  dashboardDefaults: {
    viewMode: "cards",
    sortMode: "updated-desc",
    cardTagCount: 5,
    showDraftCount: true,
    showFavoriteCount: true,
    showUpdatedTime: true,
  },
  exportDefaults: {
    jpgQuality: 0.9,
    pngScale: 2,
    pdfLightMode: true,
    includeFooter: false,
    includePromptSection: true,
    includeTimeInfo: true,
  },
  promptCenter: {
    externalLibraryEnabled: true,
    randomMissingFields: true,
    complexity: "medium",
    repeatControl: "normal",
  },
  application: {
    pageTitle: "Character Studio",
    footerText: "RINTO © 2026",
    languageMode: "zh",
    showVersion: true,
    showSprint: true,
    showBuild: true,
    showFirstAbout: true,
  },
  featureFlags: {
    developerCenter: true,
    aiSettings: true,
    promptCenter: true,
    assetLibrary: true,
    personalPreferences: true,
    compactMobileEditor: true,
    experimentalTimeline: false,
    experimentalRelationshipGraph: false,
  },
  developerMode: {
    enabled: true,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeDeveloperSettings(value: unknown): DeveloperSettings {
  if (!isRecord(value)) {
    return defaultDeveloperSettings;
  }

  return {
    ...defaultDeveloperSettings,
    ...value,
    appearance: {
      ...defaultDeveloperSettings.appearance,
      ...(isRecord(value.appearance) ? value.appearance : {}),
    },
    designTokens: {
      ...defaultDeveloperSettings.designTokens,
      ...(isRecord(value.designTokens) ? value.designTokens : {}),
    },
    brandAssets: {
      ...defaultDeveloperSettings.brandAssets,
      ...(isRecord(value.brandAssets) ? value.brandAssets : {}),
    },
    editorDefaults: {
      ...defaultDeveloperSettings.editorDefaults,
      ...(isRecord(value.editorDefaults) ? value.editorDefaults : {}),
    },
    dashboardDefaults: {
      ...defaultDeveloperSettings.dashboardDefaults,
      ...(isRecord(value.dashboardDefaults) ? value.dashboardDefaults : {}),
    },
    exportDefaults: {
      ...defaultDeveloperSettings.exportDefaults,
      ...(isRecord(value.exportDefaults) ? value.exportDefaults : {}),
    },
    promptCenter: {
      ...defaultDeveloperSettings.promptCenter,
      ...(isRecord(value.promptCenter) ? value.promptCenter : {}),
    },
    application: {
      ...defaultDeveloperSettings.application,
      ...(isRecord(value.application) ? value.application : {}),
    },
    featureFlags: {
      ...defaultDeveloperSettings.featureFlags,
      ...(isRecord(value.featureFlags) ? value.featureFlags : {}),
    },
    developerMode: {
      ...defaultDeveloperSettings.developerMode,
      ...(isRecord(value.developerMode) ? value.developerMode : {}),
    },
  };
}

export function loadDeveloperSettings() {
  try {
    return mergeDeveloperSettings(
      JSON.parse(localStorage.getItem(DEVELOPER_SETTINGS_KEY) || "null"),
    );
  } catch {
    return defaultDeveloperSettings;
  }
}

export function saveDeveloperSettings(settings: DeveloperSettings) {
  localStorage.setItem(DEVELOPER_SETTINGS_KEY, JSON.stringify(settings));
}

export function resetDeveloperSettings() {
  saveDeveloperSettings(defaultDeveloperSettings);
  return defaultDeveloperSettings;
}

export function applyDeveloperSettings(settings: DeveloperSettings) {
  const root = document.documentElement;
  const shadowMap = {
    none: ["none", "none"],
    soft: ["0 10px 28px rgba(15, 23, 42, 0.06)", "0 16px 34px rgba(15, 23, 42, 0.1)"],
    medium: ["0 12px 32px rgba(15, 23, 42, 0.1)", "0 18px 42px rgba(15, 23, 42, 0.16)"],
    strong: ["0 14px 38px rgba(15, 23, 42, 0.16)", "0 22px 54px rgba(15, 23, 42, 0.24)"],
  }[settings.appearance.shadowStrength];
  const motionMap = {
    none: ["0ms", "0ms"],
    reduced: ["90ms", "120ms"],
    normal: ["150ms", "190ms"],
  }[settings.appearance.motionLevel];

  document.title = settings.application.pageTitle || "Character Studio";
  root.style.setProperty("--primary", settings.appearance.accentColor);
  root.style.setProperty("--primary-hover", settings.appearance.accentColor);
  root.style.setProperty("--control-radius", `${settings.designTokens.inputRadius}px`);
  root.style.setProperty("--developer-card-radius", `${settings.appearance.cardRadius}px`);
  root.style.setProperty("--developer-button-radius", `${settings.appearance.buttonRadius}px`);
  root.style.setProperty("--developer-font-scale", String(settings.appearance.fontScale));
  root.style.setProperty("--shadow", shadowMap[0]);
  root.style.setProperty("--shadow-strong", shadowMap[1]);
  root.style.setProperty("--duration-fast", motionMap[0]);
  root.style.setProperty("--duration-medium", motionMap[1]);
  root.dataset.compactUi = settings.appearance.compactUi ? "true" : "false";
  root.dataset.showAppLogo = settings.brandAssets.showAppLogo ? "true" : "false";
  root.dataset.showHeaderLogo = settings.brandAssets.showHeaderLogo ? "true" : "false";
  root.dataset.aboutLogoSize = settings.brandAssets.aboutLogoSize;
  root.dataset.compactMobileEditor =
    settings.editorDefaults.compactMobileEditor && settings.featureFlags.compactMobileEditor
      ? "true"
      : "false";
}

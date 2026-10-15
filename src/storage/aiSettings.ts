// The AI settings the settings dialog offers.
//
// These seven keys used to be read and written by two copies of the same form --
// one in App, one in Dashboard -- each spelling the key names inline. Changing a
// key name, a default or a field meant editing both, and nothing could be tested
// because the values only ever existed as raw localStorage strings inside JSX.
// The keys, the defaults and the parsing live here so the form is the only thing
// left to share, and so a stored value can be asserted without a browser.

export const AI_SETTINGS_KEYS = {
  provider: "character-studio.ai.provider",
  baseUrl: "character-studio.ai.base-url",
  model: "character-studio.ai.model",
  temperature: "character-studio.ai.temperature",
  topP: "character-studio.ai.top-p",
  maxTokens: "character-studio.ai.max-tokens",
  streaming: "character-studio.ai.streaming",
} as const;

export type AiSettingId = keyof typeof AI_SETTINGS_KEYS;

export const AI_PROVIDERS = ["custom", "openai"] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  custom: "Custom",
  openai: "OpenAI Compatible",
};

export type AiSettings = {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  temperature: string;
  topP: string;
  maxTokens: string;
  streaming: boolean;
};

// Numeric fields stay strings. They are free-text number inputs, and an author
// who clears the box is mid-edit rather than asking for the default back, so
// nothing here coerces or clamps. The defaults are the values the form used to
// hardcode as `defaultValue` fallbacks.
export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: "custom",
  baseUrl: "",
  model: "",
  temperature: "0.8",
  topP: "1",
  maxTokens: "1200",
  streaming: false,
};

function isProvider(value: string): value is AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Reads the seven keys, falling back per key rather than as a block: an author
 * who has only ever changed the model still gets the default temperature.
 *
 * Storage that throws (private mode, disabled cookies) reads as "nothing
 * configured" instead of stopping the settings dialog from opening.
 */
export function loadAiSettings(): AiSettings {
  const read = (id: AiSettingId): string | null => {
    try {
      return localStorage.getItem(AI_SETTINGS_KEYS[id]);
    } catch {
      return null;
    }
  };

  const provider = read("provider");

  return {
    provider: provider && isProvider(provider) ? provider : DEFAULT_AI_SETTINGS.provider,
    baseUrl: read("baseUrl") ?? DEFAULT_AI_SETTINGS.baseUrl,
    model: read("model") ?? DEFAULT_AI_SETTINGS.model,
    temperature: read("temperature") ?? DEFAULT_AI_SETTINGS.temperature,
    topP: read("topP") ?? DEFAULT_AI_SETTINGS.topP,
    maxTokens: read("maxTokens") ?? DEFAULT_AI_SETTINGS.maxTokens,
    streaming: read("streaming") === "true",
  };
}

/**
 * Writes one field. Booleans are stored as the "true"/"false" strings the
 * previous inline handlers wrote, so values saved by an older build still read
 * back correctly. A failing write is swallowed: these are conveniences on a form
 * explicitly marked as not yet functional, never a reason to break the dialog.
 */
export function saveAiSetting(id: AiSettingId, value: string | boolean): void {
  try {
    localStorage.setItem(AI_SETTINGS_KEYS[id], typeof value === "boolean" ? String(value) : value);
  } catch {
    // Quota or private mode.
  }
}

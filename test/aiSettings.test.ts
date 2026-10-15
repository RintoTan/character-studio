// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  AI_SETTINGS_KEYS,
  DEFAULT_AI_SETTINGS,
  loadAiSettings,
  saveAiSetting,
} from "../src/storage/aiSettings";

describe("AI settings storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reports the defaults when nothing has been configured", () => {
    expect(loadAiSettings()).toEqual(DEFAULT_AI_SETTINGS);
  });

  it("round-trips a configured field", () => {
    saveAiSetting("baseUrl", "https://api.example.com/v1");
    saveAiSetting("temperature", "0.2");

    expect(loadAiSettings().baseUrl).toBe("https://api.example.com/v1");
    expect(loadAiSettings().temperature).toBe("0.2");
  });

  it("falls back per key, so one changed field keeps the other defaults", () => {
    saveAiSetting("model", "my-model");
    const settings = loadAiSettings();

    expect(settings.model).toBe("my-model");
    expect(settings.temperature).toBe(DEFAULT_AI_SETTINGS.temperature);
    expect(settings.maxTokens).toBe(DEFAULT_AI_SETTINGS.maxTokens);
  });

  it("stores the checkbox as the string the previous inline handler wrote", () => {
    saveAiSetting("streaming", true);

    expect(localStorage.getItem(AI_SETTINGS_KEYS.streaming)).toBe("true");
    expect(loadAiSettings().streaming).toBe(true);

    saveAiSetting("streaming", false);

    expect(localStorage.getItem(AI_SETTINGS_KEYS.streaming)).toBe("false");
    expect(loadAiSettings().streaming).toBe(false);
  });

  it("reads a value an older build already stored", () => {
    localStorage.setItem("character-studio.ai.provider", "openai");
    localStorage.setItem("character-studio.ai.streaming", "true");
    localStorage.setItem("character-studio.ai.top-p", "0.5");

    const settings = loadAiSettings();

    expect(settings.provider).toBe("openai");
    expect(settings.streaming).toBe(true);
    expect(settings.topP).toBe("0.5");
  });

  it("ignores a provider that is not one of the offered options", () => {
    localStorage.setItem("character-studio.ai.provider", "some-other-vendor");

    expect(loadAiSettings().provider).toBe(DEFAULT_AI_SETTINGS.provider);
  });

  it("keeps an emptied numeric box empty rather than restoring the default", () => {
    saveAiSetting("temperature", "");

    expect(loadAiSettings().temperature).toBe("");
  });

  it("uses one key per field, and only the seven it declares", () => {
    expect(Object.keys(AI_SETTINGS_KEYS).sort()).toEqual([
      "baseUrl",
      "maxTokens",
      "model",
      "provider",
      "streaming",
      "temperature",
      "topP",
    ]);
    expect(Object.values(AI_SETTINGS_KEYS)).toEqual([
      "character-studio.ai.provider",
      "character-studio.ai.base-url",
      "character-studio.ai.model",
      "character-studio.ai.temperature",
      "character-studio.ai.top-p",
      "character-studio.ai.max-tokens",
      "character-studio.ai.streaming",
    ]);
  });

  it("does not let a failing write escape", () => {
    const original = localStorage.setItem;
    localStorage.setItem = () => {
      throw new Error("QuotaExceededError");
    };

    expect(() => saveAiSetting("model", "my-model")).not.toThrow();
    localStorage.setItem = original;
  });
});

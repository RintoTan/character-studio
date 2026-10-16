import { useState } from "react";
import {
  AI_PROVIDER_LABELS,
  AI_PROVIDERS,
  loadAiSettings,
  saveAiSetting,
  type AiSettingId,
} from "../storage/aiSettings";

// The AI settings card, shared by the two dialogs that offer it.
//
// The fields are uncontrolled and seeded from storage on mount, which is what the
// two hand-written copies did. The one difference: they passed `localStorage.getItem`
// as `defaultValue` on every render, so a change could in principle re-seed a field
// mid-edit. Reading once on mount removes that.
//
// Nothing here calls a model. The card says so, the API key box is disabled and the
// connection test is inert -- the settings exist so the shape of the feature is
// visible, not so it works.

export function AiSettingsForm() {
  const [settings] = useState(loadAiSettings);

  function handle(id: AiSettingId) {
    return (event: { target: HTMLInputElement | HTMLSelectElement }) => {
      const field = event.target;

      saveAiSetting(
        id,
        field instanceof HTMLInputElement && field.type === "checkbox" ? field.checked : field.value,
      );
    };
  }

  return (
    <article className="ai-settings-card">
      <div className="settings-card-head">
        <h3>AI 设置</h3>
        <span className="status-badge draft">开发中</span>
      </div>
      <p className="muted">
        面向所有用户，开发中。当前不会调用 AI，也不会上传任何用户数据；未来可填写自己的 API Key。
      </p>
      <div className="settings-form-grid">
        <label>
          服务商
          <select defaultValue={settings.provider} onChange={handle("provider")}>
            {AI_PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>
                {AI_PROVIDER_LABELS[provider]}
              </option>
            ))}
          </select>
        </label>
        <label>
          API Key
          <input disabled placeholder="功能未启用，暂不可填写" type="password" />
        </label>
        <label>
          接口地址
          <input
            placeholder="https://api.example.com/v1"
            defaultValue={settings.baseUrl}
            onChange={handle("baseUrl")}
          />
        </label>
        <label>
          模型
          <input placeholder="model-name" defaultValue={settings.model} onChange={handle("model")} />
        </label>
        <label>
          温度
          <input
            type="number"
            min="0"
            max="2"
            step="0.1"
            defaultValue={settings.temperature}
            onChange={handle("temperature")}
          />
        </label>
        <label>
          Top P
          <input
            type="number"
            min="0"
            max="1"
            step="0.05"
            defaultValue={settings.topP}
            onChange={handle("topP")}
          />
        </label>
        <label>
          最大 Token
          <input
            type="number"
            min="1"
            step="1"
            defaultValue={settings.maxTokens}
            onChange={handle("maxTokens")}
          />
        </label>
        <label className="settings-check">
          <input type="checkbox" defaultChecked={settings.streaming} onChange={handle("streaming")} />
          <span>流式输出</span>
        </label>
      </div>
      <button className="ghost-button" disabled type="button">
        连接测试（未启用）
      </button>
    </article>
  );
}

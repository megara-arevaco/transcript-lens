export type Settings = {
  apiKey: string;
  model: string;
  presetId: string;
  customPrompt: string;
  inputTokenBudget: number;
  maxOutputTokens: number;
};
export const defaults: Settings = {
  apiKey: "",
  model: "openrouter/auto",
  presetId: "summary",
  customPrompt: "",
  inputTokenBudget: 12000,
  maxOutputTokens: 1800,
};
export async function loadSettings(): Promise<Settings> {
  await chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  const data = await chrome.storage.local.get("settings");
  const saved = data.settings as Partial<Settings> | undefined;
  return { ...defaults, ...saved };
}
export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  await chrome.storage.local.set({ settings });
}

import { invokeWithCommandError } from "../persistence/commandError.ts";

type NamedId = { id: number; name: string };
export type AiClassificationPayload = { apps: NamedId[]; categories: NamedId[] };
export type AiCategorySuggestion = { appId: number; categoryId: number };
export type AiClassificationConfig = { url: string; model: string };

export function loadAiClassificationConfig(): Promise<AiClassificationConfig | null> {
  return invokeWithCommandError("cmd_get_ai_classification_config");
}

export function listAiClassificationModels(url: string, apiKey: string): Promise<string[]> {
  return invokeWithCommandError("cmd_list_ai_classification_models", { url, apiKey });
}

export function saveAiClassificationConfig(config: AiClassificationConfig, apiKey: string): Promise<AiClassificationConfig> {
  return invokeWithCommandError("cmd_save_ai_classification_config", { config, apiKey });
}

export function suggestAiCategories(payload: AiClassificationPayload): Promise<AiCategorySuggestion[]> {
  return invokeWithCommandError("cmd_suggest_ai_categories", { payload });
}

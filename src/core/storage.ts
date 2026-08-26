const DRAFT_KEY = "contest-log-workbench:draft:v1";
const SETTINGS_KEY = "contest-log-workbench:settings:v1";

export interface LocalDraft {
  fileName: string;
  source: string;
  savedAt: string;
}

export function saveDraft(draft: LocalDraft): void {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function loadDraft(): LocalDraft | null {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null") as LocalDraft | null;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  localStorage.removeItem(DRAFT_KEY);
}

export function saveSettings(settings: Record<string, unknown>): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadSettings<T extends Record<string, unknown>>(defaults: T): T {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return defaults;
  }
}

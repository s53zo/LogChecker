type AnalyticsValue = string | number | boolean;

const SAFE_PARAMETER_KEYS = new Set([
  "action", "area", "change_bucket", "document_format", "event_category", "format",
  "operation", "record_bucket", "result", "selection", "source_type", "view",
]);

declare global {
  interface Window {
    dataLayer?: unknown[][];
    gtag?: (...args: unknown[]) => void;
  }
}

export function countBucket(count: number): string {
  if (count <= 0) return "0";
  if (count <= 10) return "1-10";
  if (count <= 100) return "11-100";
  if (count <= 1_000) return "101-1000";
  if (count <= 10_000) return "1001-10000";
  return "10000+";
}

/** Sends only allow-listed, non-log metadata to Google Analytics. */
export function trackEvent(eventName: string, parameters: Record<string, AnalyticsValue> = {}): void {
  if (typeof window.gtag !== "function") return;
  const safeParameters = Object.fromEntries(Object.entries(parameters).filter(([key]) => SAFE_PARAMETER_KEYS.has(key)));
  window.gtag("event", eventName.replace(/[^a-z0-9_]/gi, "_").slice(0, 40), safeParameters);
}

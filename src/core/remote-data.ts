export const CTY_DATA_URLS = [
  "https://azure.s53m.com/cors/cty.dat",
  "https://www.country-files.com/cty/cty.dat",
] as const;

export const MASTER_DATA_URLS = [
  "https://azure.s53m.com/cors/MASTER.DTA",
  "https://www.supercheckpartial.com/MASTER.DTA",
] as const;

export interface RemoteDataFile {
  buffer: ArrayBuffer;
  source: string;
  lastModified: string;
  etag: string;
}

export type ReferenceFetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function fetchReferenceData(
  urls: readonly string[],
  fetcher: ReferenceFetch = fetch,
  timeoutMs = 15_000,
): Promise<RemoteDataFile> {
  const errors: string[] = [];
  for (const url of urls) {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, {
        method: "GET",
        cache: "no-cache",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      if (!buffer.byteLength) throw new Error("empty response");
      return {
        buffer,
        source: url,
        lastModified: response.headers.get("last-modified") ?? "",
        etag: response.headers.get("etag") ?? "",
      };
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      globalThis.clearTimeout(timer);
    }
  }
  throw new Error(errors.length ? errors.join(" · ") : "No reference-data URL was configured.");
}

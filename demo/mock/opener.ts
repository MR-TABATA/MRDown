// `@tauri-apps/plugin-opener`. Swallow external links: the demo must never
// navigate the page away mid-recording.

export async function openUrl(url: string): Promise<void> {
  console.info(`[demo] would open externally: ${url}`);
}

export const WIDTH_KEY = 'mrdown.previewWidthPercent';
export const WIDTH_LEGACY_KEY = 'mrdown.previewWidth';
export const WIDTH_MIN = 50;
export const WIDTH_MAX = 100;
export const WIDTH_STEP = 5;
export const WIDTH_DEFAULT = 85;

export type PreviewWidth = number | 'full';

/**
 * 新旧の保存値から本文幅（% または 'full'）を決定する。
 * - 新キー (mrdown.previewWidthPercent) がある場合は 50〜100% (または 'full') を尊重。
 * - 旧キー (mrdown.previewWidth) のみがある場合:
 *   - 'full' または 480px 以上の旧ピクセル設定値は 'full' に読み替える（元の広い表示意図を維持）。
 *   - それ以外または不正値なら既定値 85% とする。
 */
export function resolvePreviewWidth(
  currentRaw: string | null,
  legacyRaw: string | null
): PreviewWidth {
  if (currentRaw !== null) {
    const trimmed = currentRaw.trim();
    if (!trimmed) return WIDTH_DEFAULT;
    if (trimmed === 'full') return 'full';
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return WIDTH_DEFAULT;
    if (n >= WIDTH_MAX) return 'full';
    if (n < WIDTH_MIN) return WIDTH_MIN;
    return n;
  }

  if (legacyRaw !== null) {
    const trimmed = legacyRaw.trim();
    if (trimmed === 'full') return 'full';
    const n = Number(trimmed);
    if (Number.isFinite(n) && n >= 480) {
      return 'full';
    }
  }

  return WIDTH_DEFAULT;
}

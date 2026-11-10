import { describe, it, expect } from 'vitest';
import { resolvePreviewWidth, WIDTH_DEFAULT, WIDTH_MIN } from './preview-width';

describe('resolvePreviewWidth', () => {
  describe('新設定キー（mrdown.previewWidthPercent）がある場合', () => {
    it('有効なパーセント数値（50〜95）はそのまま読み込まれる', () => {
      expect(resolvePreviewWidth('75', null)).toBe(75);
      expect(resolvePreviewWidth('85', null)).toBe(85);
      expect(resolvePreviewWidth('50', null)).toBe(50);
    });

    it('100 以上の数値は full に丸められる', () => {
      expect(resolvePreviewWidth('100', null)).toBe('full');
      expect(resolvePreviewWidth('120', null)).toBe('full');
    });

    it('50 未満の数値（例: 30）は最小値 50 にクランプされる', () => {
      expect(resolvePreviewWidth('30', null)).toBe(WIDTH_MIN);
      expect(resolvePreviewWidth('0', null)).toBe(WIDTH_MIN);
    });

    it('文字列 "full" は full として読み込まれる', () => {
      expect(resolvePreviewWidth('full', null)).toBe('full');
    });

    it('不正な値（NaN など）は既定値（85）になる', () => {
      expect(resolvePreviewWidth('invalid', null)).toBe(WIDTH_DEFAULT);
      expect(resolvePreviewWidth('', null)).toBe(WIDTH_DEFAULT);
    });
  });

  describe('旧設定キー（mrdown.previewWidth）からのマイグレーション', () => {
    it('旧設定が "full" の場合は full を維持する', () => {
      expect(resolvePreviewWidth(null, 'full')).toBe('full');
    });

    it('旧設定が 480px 以上のピクセル値（例: 600, 800）の場合は full に読み替える', () => {
      expect(resolvePreviewWidth(null, '600')).toBe('full');
      expect(resolvePreviewWidth(null, '800')).toBe('full');
      expect(resolvePreviewWidth(null, '480')).toBe('full');
    });

    it('旧設定が 480px 未満の不正値や空値の場合は既定値（85）になる', () => {
      expect(resolvePreviewWidth(null, '300')).toBe(WIDTH_DEFAULT);
      expect(resolvePreviewWidth(null, 'invalid')).toBe(WIDTH_DEFAULT);
    });
  });

  describe('設定が一切保存されていない初回起動', () => {
    it('既定値（85）が返る', () => {
      expect(resolvePreviewWidth(null, null)).toBe(WIDTH_DEFAULT);
    });
  });
});

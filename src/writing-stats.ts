// 「今日」の増分の基準点。文書ごとに、その日に最初に見たときの文字数を
// 覚えておき、いまの文字数との差を出す。DOM にも Tauri にも触れない。

export interface Baselines {
  /** 基準点を取った日（YYYY-MM-DD・ローカル時刻）。日が変わったら捨てる。 */
  day: string;
  chars: Record<string, number>;
}

export const BASELINE_MAX = 200;

export function localDay(d = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd}`;
}

/** 保存済みの JSON から基準点を読む。壊れていても空から始める（統計が止めてよいものは無い）。 */
export function parseBaselines(raw: string | null, today: string): Baselines {
  try {
    const v = JSON.parse(raw ?? '');
    if (v && v.day === today && v.chars && typeof v.chars === 'object') return v as Baselines;
  } catch {
    // fall through
  }
  return { day: today, chars: {} };
}

/**
 * その日に初めて見たパスなら、いまの文字数を基準点として記録する。
 * 戻り値の `base` は、そのパスの今日の基準点。
 */
export function noteBaseline(b: Baselines, path: string, chars: number): number {
  if (!(path in b.chars)) {
    b.chars[path] = chars;
    const keys = Object.keys(b.chars);
    for (const k of keys.slice(0, Math.max(0, keys.length - BASELINE_MAX))) delete b.chars[k];
  }
  return b.chars[path];
}

/** 増分の表示用。+120 / −30 / 0。 */
export function formatDelta(n: number): string {
  if (n > 0) return `+${n.toLocaleString()}`;
  if (n < 0) return `−${Math.abs(n).toLocaleString()}`;
  return '0';
}

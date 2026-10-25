// ⌘⇧T「閉じたファイルを開き直す」のスタック。ブラウザの「閉じたタブを開く」と同じで、
// 閉じた順に積み、押すたびに新しい方から 1 件取り出す。DOM にも Tauri にも触れない。

export const CLOSED_MAX = 20;

/** 閉じたパスを積む。同じパスが既にあれば古い方を捨てて、先頭（最新）へ寄せる。 */
export function pushClosed(stack: string[], path: string, max = CLOSED_MAX): void {
  const i = stack.indexOf(path);
  if (i !== -1) stack.splice(i, 1);
  stack.push(path);
  if (stack.length > max) stack.splice(0, stack.length - max);
}

/**
 * 開き直せる最新の 1 件を取り出す。既に開いている・もう存在しないものは
 * 黙って読み捨てる（押すたびに「何も起きない」になるのを避ける）。無ければ null。
 */
export async function popReopenable(
  stack: string[],
  isOpen: (path: string) => boolean,
  exists: (path: string) => Promise<boolean>
): Promise<string | null> {
  while (stack.length) {
    const path = stack.pop()!;
    if (isOpen(path)) continue;
    if (await exists(path)) return path;
  }
  return null;
}

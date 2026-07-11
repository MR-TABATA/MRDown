// `@tauri-apps/api/event`. The app listens for `open-file` (Finder "Open With")
// and `menu` (native menu clicks). Neither has a browser equivalent, so we keep
// the listeners and let the harness fire them: `window.__emit('menu', 'outline')`
// drives exactly the path a real menu click would.

type Handler = (e: { payload: any }) => void;

const listeners = new Map<string, Handler[]>();

export async function listen<T>(event: string, cb: (e: { payload: T }) => void) {
  const handlers = listeners.get(event) ?? [];
  handlers.push(cb as Handler);
  listeners.set(event, handlers);
  return () => {
    const rest = (listeners.get(event) ?? []).filter((h) => h !== cb);
    listeners.set(event, rest);
  };
}

if (typeof window !== 'undefined') {
  window.__emit = (event, payload) => {
    for (const cb of listeners.get(event) ?? []) cb({ payload });
  };
}

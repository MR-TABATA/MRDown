// `@tauri-apps/api/event`. The app listens for `open-file` (Finder "Open With")
// and `menu` (native menu clicks). Neither fires in a browser.

export async function listen<T>(_event: string, _cb: (e: { payload: T }) => void) {
  return () => {};
}

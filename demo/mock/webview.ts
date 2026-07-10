// `@tauri-apps/api/webview`. The app registers one drag-drop handler; the demo
// keeps a reference so the scenario can drop a file without a real OS drag.

export function getCurrentWebview() {
  return {
    async onDragDropEvent(cb: (event: { payload: { type: string; paths?: string[] } }) => void) {
      window.__dropHandler = cb;
      return () => {};
    },
  };
}

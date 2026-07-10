// `@tauri-apps/api/window`. Only setTitle is used, and a browser tab title is
// close enough — the recording crops to the window frame anyway.

export function getCurrentWindow() {
  return {
    async setTitle(title: string) {
      document.title = title;
    },
  };
}

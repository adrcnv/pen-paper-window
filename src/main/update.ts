import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { existsSync } from "node:fs";
import { join } from "node:path";

// The window updating itself from the GitHub releases of its own repository,
// as named in the app-update.yml a release build carries: asked once at
// launch, downloaded in the background, put in place when the window is
// next closed. It checks the download against the release's SHA-512 before
// using it. Only where that can work: a packaged Windows install or a Linux
// AppImage whose build named a repository. A Mac can't update an unsigned
// app, and the window run from the source isn't an install; they learn of
// a new window in the news instead (renderer/news.ts). Nothing of it
// reaches the player, a failure included; with HARNESS_DEV set, what it
// did is printed, to watch a release reach an installed window.
export function selfUpdates(): boolean {
  if (!app.isPackaged || !existsSync(join(process.resourcesPath, "app-update.yml"))) return false;
  return process.platform === "win32" || (process.platform === "linux" && !!process.env.APPIMAGE);
}

export function updateQuietly(): void {
  if (!selfUpdates()) return;
  autoUpdater.logger = process.env.HARNESS_DEV ? console : null;
  autoUpdater.on("error", () => {});
  autoUpdater.checkForUpdates().catch(() => {});
}

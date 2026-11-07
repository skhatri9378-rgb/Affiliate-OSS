import { app, BrowserWindow, dialog, shell, session } from "electron";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { appServer } from "../server/index.mjs";
import { Store } from "../server/store.mjs";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
let server, store, window;
let stopping = false;
const smoke = process.argv.includes("--smoke-test");
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      const dataDir =
        process.env.AFFILIATE_OS_DATA_DIR ||
        (process.platform === "darwin"
          ? join(
              homedir(),
              "Library",
              "Application Support",
              "com.affiliateos.desktop",
            )
          : app.getPath("userData"));
      if (smoke && !process.env.AFFILIATE_OS_DATA_DIR)
        throw Error("Smoke testing requires an isolated data directory.");
      store = new Store(join(dataDir, "affiliate-os.sqlite"));
      server = appServer(store, {
        port: 0,
        devPort: -1,
        dist: join(root, "dist"),
      });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const origin = `http://127.0.0.1:${server.address().port}`;
      session.defaultSession.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      const createWindow = async () => {
        window = new BrowserWindow({
          width: 1380,
          height: 900,
          minWidth: 850,
          minHeight: 600,
          title: "Affiliate Links",
          show: false,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
        });
        const external = (url) => {
          try {
            if (["http:", "https:"].includes(new URL(url).protocol))
              void shell.openExternal(url);
          } catch {
            /* Ignore invalid URLs. */
          }
        };
        window.webContents.setWindowOpenHandler(({ url }) => {
          external(url);
          return { action: "deny" };
        });
        window.webContents.on("will-navigate", (event, url) => {
          if (new URL(url).origin !== origin) {
            event.preventDefault();
            external(url);
          }
        });
        window.webContents.on("will-attach-webview", (event) =>
          event.preventDefault(),
        );
        window.once("ready-to-show", () => {
          if (!smoke) window.show();
        });
        window.on("closed", () => {
          window = null;
        });
        await window.loadURL(origin);
        if (smoke) {
          const state = await window.webContents.executeJavaScript(
            `(async () => { const response = await fetch('/api/state'); const state = await response.json(); const country = await fetch('/api/label', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'countries',name:'Smoke country'})}); return { title:document.title, mounted:!!document.querySelector('#root')?.children.length, api:response.ok, write:country.ok, links:state.total }; })()`,
          );
          if (!state.mounted || !state.api || !state.write)
            throw Error(JSON.stringify(state));
          console.log("ELECTRON_SMOKE_OK", JSON.stringify(state));
          app.quit();
        }
      };
      app.on("activate", () => {
        if (!window) void createWindow().catch(fail);
      });
      await createWindow();
    })
    .catch(fail);
}
function fail(error) {
  console.error(error);
  if (!smoke)
    dialog.showErrorBox("Affiliate Links could not start", String(error));
  process.exitCode = 1;
  app.quit();
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", (event) => {
  if (!server || stopping) return;
  event.preventDefault();
  stopping = true;
  server.close(() => {
    store?.close();
    server = null;
    app.quit();
  });
  server.closeAllConnections();
});

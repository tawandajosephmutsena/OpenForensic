const { app, BrowserWindow, ipcMain, protocol, safeStorage, shell } = require("electron");
const { readFile, stat } = require("node:fs/promises");
const path = require("node:path");
const { createAgentService } = require("./agent.cjs");
const { createChatGPTAuth } = require("./chatgpt.cjs");

const SCHEME = "openforensic";
const APP_ORIGIN = `${SCHEME}://app`;
const EXPORT_DIR = path.join(__dirname, "..", "out");
const DEV_URL = process.env.OPEN_FORENSIC_DEV_URL || "";
const DEV_ORIGIN = DEV_URL ? new URL(DEV_URL).origin : null;
const agent = createAgentService();
let chatgpt = null;
let activeProvider = null;

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

async function resolveExportFile(url) {
  const parsed = new URL(url);
  if (parsed.hostname !== "app") return null;
  const pathname = decodeURIComponent(parsed.pathname);
  const normalized = path.posix.normalize(pathname);
  if (!normalized.startsWith("/") || normalized.includes("..")) return null;
  const candidates = normalized === "/" ? ["/index.html"] : path.posix.extname(normalized)
    ? [normalized]
    : [`${normalized.replace(/\/$/, "")}.html`, `${normalized.replace(/\/$/, "")}/index.html`];
  for (const candidate of candidates) {
    const file = path.resolve(EXPORT_DIR, `.${candidate}`);
    if (!file.startsWith(`${EXPORT_DIR}${path.sep}`)) continue;
    try { if ((await stat(file)).isFile()) return file; } catch { /* Try next candidate. */ }
  }
  return null;
}

function trustedSender(event) {
  try {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
    const url = new URL(event.senderFrame.url);
    return (url.protocol === `${SCHEME}:` && url.host === "app") || (DEV_ORIGIN && url.origin === DEV_ORIGIN);
  } catch { return false; }
}

function protect(handler) {
  return (event, ...args) => {
    if (!trustedSender(event)) throw new Error("Untrusted agent request.");
    return handler(...args);
  };
}

ipcMain.handle("agent:connect", protect(async (apiKey) => {
  const result = await agent.connect(apiKey);
  if (result.connected) activeProvider = "api-key";
  return { ...result, provider: result.connected ? "api-key" : null };
}));
ipcMain.handle("agent:disconnect", protect(() => {
  agent.disconnect();
  if (activeProvider === "api-key") activeProvider = null;
}));
ipcMain.handle("agent:sign-in-chatgpt", protect(async () => {
  try {
    const result = await chatgpt.signIn();
    if (result.connected) { agent.disconnect(); activeProvider = "chatgpt"; }
    return result;
  } catch (error) {
    return { connected: false, error: error instanceof Error ? error.message : "ChatGPT sign-in failed." };
  }
}));
ipcMain.handle("agent:sign-out-chatgpt", protect(async () => {
  try { await chatgpt.signOut(); }
  finally { if (activeProvider === "chatgpt") activeProvider = null; }
}));
ipcMain.handle("agent:status", protect(async () => {
  if (activeProvider === "api-key" && agent.status().connected) return { connected: true, provider: "api-key" };
  const state = await chatgpt.status();
  if (state.connected) { activeProvider = "chatgpt"; return state; }
  return agent.status().connected ? { connected: true, provider: "api-key" } : { connected: false, provider: null };
}));
ipcMain.handle("agent:ask", protect(async (request) => {
  if (activeProvider === "chatgpt") return chatgpt.ask(request);
  if (activeProvider === "api-key") return agent.ask(request);
  const state = await chatgpt.status();
  if (state.connected) { activeProvider = "chatgpt"; return chatgpt.ask(request); }
  return agent.ask(request);
}));

function openExternalIfSafe(target) {
  try {
    const url = new URL(target);
    if (url.protocol === "https:") void shell.openExternal(url.href);
  } catch { /* Ignore invalid links. */ }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 650,
    title: "Open Forensic",
    backgroundColor: "#F5FAF8",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => { openExternalIfSafe(url); return { action: "deny" }; });
  window.webContents.on("will-navigate", (event, url) => {
    try {
      const destination = new URL(url);
      if ((destination.protocol === `${SCHEME}:` && destination.host === "app") || (DEV_ORIGIN && destination.origin === DEV_ORIGIN)) return;
    } catch { /* Deny malformed URLs. */ }
    event.preventDefault();
    openExternalIfSafe(url);
  });
  void window.loadURL(DEV_URL || `${APP_ORIGIN}/`);
}

app.whenReady().then(() => {
  chatgpt = createChatGPTAuth({ userDataDir: app.getPath("userData"), openExternal: (url) => shell.openExternal(url), safeStorage });
  protocol.handle(SCHEME, async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 });
    const file = await resolveExportFile(request.url);
    if (!file) return new Response("Not found", { status: 404 });
    const data = request.method === "HEAD" ? null : await readFile(file);
    return new Response(data, { headers: { "Content-Type": CONTENT_TYPES[path.extname(file)] || "application/octet-stream" } });
  });
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => agent.disconnect());

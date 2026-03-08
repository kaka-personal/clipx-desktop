"use strict";

const { app, BrowserWindow, Menu, Tray, clipboard, nativeImage, globalShortcut, ipcMain, shell, screen, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { execFile } = require("child_process");

const APP_NAME = "ClipX Desktop";
const TRAY_ICON_PATH = path.join(__dirname, "..", "assets", "tray-icon.png");
const SOUND_DIR_PATH = path.join(__dirname, "..", "assets", "sounds");
const PINNED_SHORTCUT_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
const DEFAULT_CONFIG = {
  maxHistory: 100,
  pollIntervalMs: 500,
  showManagerOnStartup: false,
  saveHistoryAcrossSessions: true,
  purgeBitmapEntriesBetweenSessions: false,
  ignoreText: false,
  ignoreImages: false,
  ignoreFiles: false,
  pasteStrategy: "ctrl-v",
  autoPaste: true,
  clearLastHistoryOnClipboardEmpty: false,
  playSoundOnCapture: true,
  soundFile: "builtin:click.wav",
  showTrayIcon: true,
  runOnStartup: true,
  hotkeys: {
    togglePopup: "CommandOrControl+Shift+V",
    openManager: "CommandOrControl+Shift+H"
  }
};

let tray;
let popupWindow;
let managerWindow;
let previewWindow;
let soundWindow;
let clipboardInterval;
let isMonitoringPaused = false;
let isQuitting = false;
let popupScrollEnabled = false;
let lastClipboardHadContent = false;
let ignoredClipboardSignature = "";
let runtime;
let pluginHost;

function getBuiltinSoundOptions() {
  if (!fs.existsSync(SOUND_DIR_PATH)) {
    return [];
  }

  return fs.readdirSync(SOUND_DIR_PATH)
    .filter((file) => file.toLowerCase().endsWith(".wav"))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => ({
      value: `builtin:${file}`,
      label: path.parse(file).name,
      fileName: file
    }));
}

function resolveSoundFile(soundFile) {
  if (!soundFile) {
    return "";
  }
  if (soundFile.startsWith("builtin:")) {
    return path.join(SOUND_DIR_PATH, soundFile.slice("builtin:".length));
  }
  return soundFile;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function createRuntime() {
  const userData = app.getPath("userData");
  const dataDir = path.join(userData, "data");
  const pluginsDir = path.join(userData, "plugins");
  const collectionsDir = path.join(dataDir, "collections");
  ensureDir(dataDir);
  ensureDir(pluginsDir);
  ensureDir(collectionsDir);

  const persisted = readJson(path.join(dataDir, "state.json"), {});
  const persistedConfig = persisted.config || {};
  const normalizedConfig = {
    ...DEFAULT_CONFIG,
    ...persistedConfig,
    hotkeys: {
      ...DEFAULT_CONFIG.hotkeys,
      ...(persistedConfig.hotkeys || {})
    }
  };

  // Keep these enabled by default for existing installs as requested.
  normalizedConfig.soundFile = DEFAULT_CONFIG.soundFile;
  normalizedConfig.playSoundOnCapture = true;
  normalizedConfig.runOnStartup = true;

  return {
    dataDir,
    pluginsDir,
    collectionsDir,
    stateFile: path.join(dataDir, "state.json"),
    lastSignature: "",
    suppressNextPoll: false,
    state: {
      config: normalizedConfig,
      history: Array.isArray(persisted.history) ? persisted.history : [],
      pinned: Array.isArray(persisted.pinned) ? persisted.pinned : [],
      collections: Array.isArray(persisted.collections) ? persisted.collections : []
    }
  };
}

function saveState() {
  const historyToPersist = runtime.state.config.saveHistoryAcrossSessions
    ? runtime.state.history.filter((item) => !(runtime.state.config.purgeBitmapEntriesBetweenSessions && item.type === "image"))
    : [];

  writeJson(runtime.stateFile, {
    ...runtime.state,
    history: historyToPersist
  });
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function truncate(input, max = 60) {
  const value = (input || "").replace(/\s+/g, " ").trim();
  if (!value) {
    return "(empty)";
  }
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function decodeFileList(buffer) {
  if (!buffer || !buffer.length) {
    return [];
  }
  return buffer.toString("ucs2").replace(/\u0000+$/, "").split("\u0000").filter(Boolean);
}

function signatureForClip(clip) {
  if (!clip) {
    return "";
  }
  if (clip.type === "text") {
    return `text:${clip.text}`;
  }
  if (clip.type === "files") {
    return `files:${clip.files.join("|")}`;
  }
  if (clip.type === "image") {
    return `image:${clip.imageDataUrl.slice(0, 160)}`;
  }
  return "";
}

function getPublicState() {
  return {
    appName: APP_NAME,
    monitoringPaused: isMonitoringPaused,
    popupScrollEnabled,
    soundOptions: getBuiltinSoundOptions(),
    config: runtime.state.config,
    history: runtime.state.history,
    pinned: runtime.state.pinned,
    collections: runtime.state.collections
  };
}

function notifyWindows() {
  const state = getPublicState();
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.webContents.send("state:updated", state);
  }
  if (managerWindow && !managerWindow.isDestroyed()) {
    managerWindow.webContents.send("state:updated", state);
  }
}

function applyLoginItemSettings() {
  app.setLoginItemSettings({
    openAtLogin: Boolean(runtime.state.config.runOnStartup)
  });
}

function syncTrayVisibility() {
  if (runtime.state.config.showTrayIcon) {
    if (!tray || tray.isDestroyed()) {
      createTray();
      return;
    }
    refreshTrayMenu();
    return;
  }

  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    tray = null;
  }
}

function hidePreviewWindow() {
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.hide();
  }
}

function playSoundFile(soundFile) {
  const resolvedPath = resolveSoundFile(soundFile);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return;
  }
  if (!soundWindow || soundWindow.isDestroyed()) {
    return;
  }
  soundWindow.webContents.send("sound:play", {
    soundUrl: pathToFileURL(resolvedPath).href
  });
}

function playConfiguredSound() {
  if (!runtime.state.config.playSoundOnCapture || !runtime.state.config.soundFile) {
    return;
  }
  playSoundFile(runtime.state.config.soundFile);
}

function createPluginHost() {
  const api = {
    openExternal: (url) => shell.openExternal(url),
    getState: () => getPublicState()
  };

  return {
    plugins: [],
    load() {
      const files = fs.readdirSync(runtime.pluginsDir).filter((file) => file.endsWith(".js"));
      this.plugins = files.map((file) => {
        try {
          const mod = require(path.join(runtime.pluginsDir, file));
          return typeof mod.setup === "function" ? mod.setup(api) || {} : mod;
        } catch {
          return {};
        }
      });
    },
    runHook(name, payload) {
      this.plugins.forEach((plugin) => {
        if (typeof plugin[name] === "function") {
          try {
            plugin[name](payload);
          } catch {
          }
        }
      });
    }
  };
}

function captureClipboardSnapshot() {
  const formats = clipboard.availableFormats();
  const text = clipboard.readText();
  const files = formats.includes("FileNameW") ? decodeFileList(clipboard.readBuffer("FileNameW")) : [];
  const image = clipboard.readImage();

  if (text && !runtime.state.config.ignoreText) {
    return { id: generateId(), type: "text", title: truncate(text), text, createdAt: new Date().toISOString(), formats };
  }
  if (files.length && !runtime.state.config.ignoreFiles) {
    return { id: generateId(), type: "files", title: truncate(files.join(", ")), files, createdAt: new Date().toISOString(), formats };
  }
  if (!image.isEmpty() && !runtime.state.config.ignoreImages) {
    return {
      id: generateId(),
      type: "image",
      title: `Image ${image.getSize().width}x${image.getSize().height}`,
      imageDataUrl: image.toDataURL(),
      createdAt: new Date().toISOString(),
      formats
    };
  }
  return null;
}

function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) {
    return;
  }
  const template = [
    { label: "打开设置", click: () => showManager("settings") },
    { label: "打开快速面板", click: showPopup },
    { type: "separator" },
    { label: isMonitoringPaused ? "恢复监听" : "暂停监听", click: toggleMonitoring },
    { label: "清空历史", click: clearHistory },
    { label: "清空当前剪贴板", click: clearClipboard },
    { type: "separator" },
    { label: "退出", click: () => app.quit() }
  ];

  pluginHost.runHook("onMenuBuilding", { template });
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function selectPinnedSlot(slotIndex) {
  const clip = runtime.state.pinned[slotIndex];
  if (!clip) {
    return { ok: false };
  }
  return selectClip(clip.id);
}

function upsertHistoryItem(clip) {
  const signature = signatureForClip(clip);
  if (!signature || signature === runtime.lastSignature) {
    return;
  }
  if (signature === ignoredClipboardSignature) {
    ignoredClipboardSignature = "";
    runtime.lastSignature = signature;
    return;
  }

  runtime.lastSignature = signature;
  runtime.state.history = runtime.state.history.filter((item) => signatureForClip(item) !== signature);
  runtime.state.history.unshift(clip);
  runtime.state.history = runtime.state.history.slice(0, runtime.state.config.maxHistory);
  pluginHost.runHook("onClipCaptured", { clip, state: getPublicState() });
  playConfiguredSound();
  saveState();
  refreshTrayMenu();
  notifyWindows();
}

function writeClipToClipboard(clip) {
  ignoredClipboardSignature = signatureForClip(clip);
  runtime.suppressNextPoll = true;
  clipboard.clear();
  if (clip.type === "text") {
    clipboard.writeText(clip.text || "");
  } else if (clip.type === "image" && clip.imageDataUrl) {
    clipboard.writeImage(nativeImage.createFromDataURL(clip.imageDataUrl));
  } else if (clip.type === "files" && Array.isArray(clip.files)) {
    clipboard.writeBuffer("FileNameW", Buffer.from(`${clip.files.join("\u0000")}\u0000\u0000`, "ucs2"));
  }
  setTimeout(() => {
    runtime.suppressNextPoll = false;
  }, runtime.state.config.pollIntervalMs * 2);
}

function sendPasteKeys() {
  if (!runtime.state.config.autoPaste) {
    return;
  }
  const script = runtime.state.config.pasteStrategy === "shift-insert"
    ? "[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); [System.Windows.Forms.SendKeys]::SendWait('+{INSERT}')"
    : "[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); [System.Windows.Forms.SendKeys]::SendWait('^v')";
  setTimeout(() => {
    execFile("powershell", ["-NoProfile", "-Command", script], { windowsHide: true }, () => {});
  }, 80);
}

function selectClip(clipId) {
  const all = [
    ...runtime.state.history,
    ...runtime.state.pinned,
    ...runtime.state.collections.flatMap((collection) => collection.items)
  ];
  const clip = all.find((item) => item.id === clipId);
  if (!clip) {
    return { ok: false };
  }
  writeClipToClipboard(clip);
  if (popupWindow && popupWindow.isVisible()) {
    popupWindow.hide();
  }
  hidePreviewWindow();
  sendPasteKeys();
  notifyWindows();
  return { ok: true };
}

function togglePinned(clipId) {
  const pinned = runtime.state.pinned.find((item) => item.id === clipId);
  if (pinned) {
    runtime.state.pinned = runtime.state.pinned.filter((item) => item.id !== clipId);
  } else {
    const item = runtime.state.history.find((entry) => entry.id === clipId);
    if (item) {
      runtime.state.pinned.unshift({ ...item });
    }
  }
  saveState();
  registerShortcuts();
  refreshTrayMenu();
  notifyWindows();
}

function createPinnedText(payload) {
  const text = (payload?.text || "").trim();
  const title = (payload?.title || "").trim() || truncate(text || "新建常驻片段");
  if (!text) {
    return { ok: false, error: "empty_text" };
  }

  const item = {
    id: generateId(),
    type: "text",
    title,
    text,
    createdAt: new Date().toISOString(),
    formats: ["text/plain"]
  };
  runtime.state.pinned.unshift(item);
  saveState();
  registerShortcuts();
  refreshTrayMenu();
  notifyWindows();
  return { ok: true, item };
}

function createPinnedFromClipboard() {
  const clip = captureClipboardSnapshot();
  if (!clip) {
    return { ok: false, error: "empty_clipboard" };
  }
  runtime.state.pinned.unshift({ ...clip, id: generateId() });
  saveState();
  registerShortcuts();
  refreshTrayMenu();
  notifyWindows();
  return { ok: true };
}

function updatePinned(payload) {
  const index = runtime.state.pinned.findIndex((item) => item.id === payload?.id);
  if (index < 0) {
    return { ok: false, error: "not_found" };
  }

  const current = runtime.state.pinned[index];
  const nextTitle = (payload?.title || "").trim();
  const nextText = typeof payload?.text === "string" ? payload.text : current.text;
  if (current.type === "text" && !String(nextText || "").trim()) {
    return { ok: false, error: "empty_text" };
  }

  runtime.state.pinned[index] = {
    ...current,
    title: nextTitle || current.title,
    text: current.type === "text" ? nextText : current.text
  };
  saveState();
  refreshTrayMenu();
  notifyWindows();
  return { ok: true, item: runtime.state.pinned[index] };
}

function removePinned(clipId) {
  runtime.state.pinned = runtime.state.pinned.filter((item) => item.id !== clipId);
  saveState();
  registerShortcuts();
  refreshTrayMenu();
  notifyWindows();
  return { ok: true };
}

function deleteClip(clipId) {
  runtime.state.history = runtime.state.history.filter((item) => item.id !== clipId);
  runtime.state.pinned = runtime.state.pinned.filter((item) => item.id !== clipId);
  runtime.state.collections = runtime.state.collections.map((collection) => ({
    ...collection,
    items: collection.items.filter((item) => item.id !== clipId)
  }));
  saveState();
  registerShortcuts();
  refreshTrayMenu();
  notifyWindows();
}

function saveCollection(name, itemIds) {
  const items = [...runtime.state.history, ...runtime.state.pinned].filter((item) => itemIds.includes(item.id));
  const collection = {
    id: generateId(),
    name,
    createdAt: new Date().toISOString(),
    items: items.map((item) => ({ ...item, id: generateId() }))
  };
  runtime.state.collections.unshift(collection);
  writeJson(path.join(runtime.collectionsDir, `${collection.id}.json`), collection);
  saveState();
  notifyWindows();
  return collection;
}

function loadCollection(collectionId) {
  const collection = runtime.state.collections.find((item) => item.id === collectionId);
  if (!collection) {
    return false;
  }
  const clones = collection.items.map((item) => ({ ...item, id: generateId(), createdAt: new Date().toISOString() }));
  runtime.state.history = [...clones, ...runtime.state.history].slice(0, runtime.state.config.maxHistory);
  saveState();
  refreshTrayMenu();
  notifyWindows();
  return true;
}

function removeCollection(collectionId) {
  runtime.state.collections = runtime.state.collections.filter((item) => item.id !== collectionId);
  const filePath = path.join(runtime.collectionsDir, `${collectionId}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  saveState();
  notifyWindows();
}

function clearHistory() {
  runtime.state.history = [];
  saveState();
  refreshTrayMenu();
  notifyWindows();
}

function clearClipboard() {
  clipboard.clear();
}

function toggleMonitoring() {
  isMonitoringPaused = !isMonitoringPaused;
  refreshTrayMenu();
  notifyWindows();
}

function createTray() {
  const image = nativeImage.createFromPath(TRAY_ICON_PATH).resize({ width: 16, height: 16 });
  tray = new Tray(image);
  tray.setToolTip(APP_NAME);
  tray.on("click", showPopup);
  tray.on("double-click", () => showManager("settings"));
  refreshTrayMenu();
}

function createWindows() {
  popupWindow = new BrowserWindow({
    width: 500,
    height: 200,
    frame: false,
    show: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, "preload.js") }
  });
  popupWindow.loadFile(path.join(__dirname, "renderer", "index.html"), { query: { view: "popup" } });
  popupWindow.on("blur", () => {
    popupWindow.hide();
    hidePreviewWindow();
  });

  previewWindow = new BrowserWindow({
    width: 520,
    height: 380,
    frame: false,
    show: false,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, "preload.js") }
  });
  previewWindow.loadFile(path.join(__dirname, "renderer", "preview.html"));

  soundWindow = new BrowserWindow({
    width: 1,
    height: 1,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      backgroundThrottling: false
    }
  });
  soundWindow.loadFile(path.join(__dirname, "renderer", "sound.html"));

  managerWindow = new BrowserWindow({
    width: 1140,
    height: 780,
    show: false,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js") }
  });
  managerWindow.loadFile(path.join(__dirname, "renderer", "index.html"), { query: { view: "manager" } });
  managerWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();
    managerWindow.hide();
  });
}

function showPopup() {
  const display = screen.getPrimaryDisplay();
  const historyCount = Math.min(runtime.state.history.length, 25);
  const pinnedCount = Math.min(runtime.state.pinned.length, 26);
  const dividerHeight = pinnedCount ? 3 : 0;
  const chromePadding = 2;
  const mainPadding = 4;
  const listBorders = 0;
  const rowHeight = 22;
  const contentHeight = chromePadding + mainPadding + listBorders + ((historyCount + pinnedCount) * rowHeight) + dividerHeight;
  const maxHeight = display.workArea.height - 12;
  popupScrollEnabled = contentHeight > maxHeight;
  const height = Math.max(80, Math.min(contentHeight, maxHeight));
  const width = 500;

  popupWindow.setSize(width, height, false);

  const trayBounds = typeof tray.getBounds === "function" ? tray.getBounds() : null;
  let x = display.workArea.x + display.workArea.width - width;
  let y = display.workArea.y + display.workArea.height - height - 12;

  if (trayBounds && trayBounds.width > 0 && trayBounds.height > 0) {
    y = Math.round(trayBounds.y - height - 6);

    if (y < display.workArea.y) {
      y = Math.round(trayBounds.y + trayBounds.height + 6);
    }
  }

  x = Math.max(display.workArea.x, Math.min(x, display.workArea.x + display.workArea.width - width));
  y = Math.max(display.workArea.y + 4, Math.min(y, display.workArea.y + display.workArea.height - height - 4));

  popupWindow.setPosition(x, y);
  hidePreviewWindow();
  popupWindow.show();
  popupWindow.focus();
  popupWindow.webContents.send("state:updated", getPublicState());
  popupWindow.webContents.send("view:focus-search");
}

function showManager(tab = "settings") {
  managerWindow.show();
  managerWindow.focus();
  managerWindow.webContents.send("view:set-tab", tab);
}

function startClipboardMonitor() {
  clearInterval(clipboardInterval);
  clipboardInterval = setInterval(() => {
    if (isMonitoringPaused || runtime.suppressNextPoll) {
      return;
    }
    const hadContent = clipboard.availableFormats().length > 0;
    if (!hadContent && lastClipboardHadContent && runtime.state.config.clearLastHistoryOnClipboardEmpty) {
      runtime.state.history = runtime.state.history.slice(1);
      saveState();
      refreshTrayMenu();
      notifyWindows();
    }
    lastClipboardHadContent = hadContent;
    const clip = captureClipboardSnapshot();
    if (clip) {
      upsertHistoryItem(clip);
    }
  }, runtime.state.config.pollIntervalMs);
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  globalShortcut.register(runtime.state.config.hotkeys.togglePopup, showPopup);
  globalShortcut.register(runtime.state.config.hotkeys.openManager, showManager);
  PINNED_SHORTCUT_DIGITS.forEach((digit, index) => {
    globalShortcut.register(`CommandOrControl+${digit}`, () => {
      selectPinnedSlot(index);
    });
  });
}

ipcMain.handle("state:get", () => getPublicState());
ipcMain.handle("clip:select", (_, clipId) => selectClip(clipId));
ipcMain.handle("clip:pin-toggle", (_, clipId) => togglePinned(clipId));
ipcMain.handle("pinned:create-text", (_, payload) => createPinnedText(payload));
ipcMain.handle("pinned:create-from-clipboard", () => createPinnedFromClipboard());
ipcMain.handle("pinned:update", (_, payload) => updatePinned(payload));
ipcMain.handle("pinned:remove", (_, clipId) => removePinned(clipId));
ipcMain.handle("clip:delete", (_, clipId) => deleteClip(clipId));
ipcMain.handle("history:clear", () => clearHistory());
ipcMain.handle("clipboard:clear", () => clearClipboard());
ipcMain.handle("monitoring:toggle", () => toggleMonitoring());
ipcMain.handle("settings:preview-sound", (_, soundFile) => {
  playSoundFile(soundFile || runtime.state.config.soundFile);
  return { ok: true };
});
ipcMain.handle("settings:pick-sound-file", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Wave Files", extensions: ["wav"] }]
  });
  if (result.canceled || !result.filePaths.length) {
    return { canceled: true };
  }
  return { canceled: false, path: result.filePaths[0] };
});
ipcMain.handle("settings:update", (_, nextConfig) => {
  runtime.state.config = {
    ...runtime.state.config,
    ...nextConfig,
    hotkeys: { ...runtime.state.config.hotkeys, ...((nextConfig && nextConfig.hotkeys) || {}) }
  };
  saveState();
  applyLoginItemSettings();
  syncTrayVisibility();
  startClipboardMonitor();
  registerShortcuts();
  notifyWindows();
});
ipcMain.handle("collection:save", (_, payload) => saveCollection(payload.name, payload.itemIds));
ipcMain.handle("collection:load", (_, collectionId) => loadCollection(collectionId));
ipcMain.handle("collection:remove", (_, collectionId) => removeCollection(collectionId));
ipcMain.handle("item:open", (_, value) => shell.openPath(value));
ipcMain.handle("item:search-web", (_, query) => shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(query)}`));
ipcMain.handle("item:open-url", (_, url) => shell.openExternal(url));
ipcMain.on("preview:hide", () => hidePreviewWindow());
ipcMain.on("preview:show", (_, payload) => {
  if (!previewWindow || previewWindow.isDestroyed() || !payload || !payload.imageDataUrl || !payload.anchorRect) {
    return;
  }

  const width = 520;
  const height = 380;
  const point = { x: payload.anchorRect.left, y: payload.anchorRect.top };
  const display = screen.getDisplayNearestPoint(point);
  let x = payload.anchorRect.left - width - 12;
  let y = payload.anchorRect.top;

  if (x < display.workArea.x + 4) {
    x = payload.anchorRect.right + 12;
  }
  if (x + width > display.workArea.x + display.workArea.width - 4) {
    x = display.workArea.x + display.workArea.width - width - 4;
  }
  if (y + height > display.workArea.y + display.workArea.height - 4) {
    y = display.workArea.y + display.workArea.height - height - 4;
  }
  if (y < display.workArea.y + 4) {
    y = display.workArea.y + 4;
  }

  previewWindow.setBounds({ x, y, width, height });
  previewWindow.webContents.send("preview:update", {
    title: payload.title,
    imageDataUrl: payload.imageDataUrl
  });
  previewWindow.showInactive();
});

app.whenReady().then(() => {
  app.setAppUserModelId(APP_NAME);
  runtime = createRuntime();
  saveState();
  if (runtime.state.config.purgeBitmapEntriesBetweenSessions) {
    runtime.state.history = runtime.state.history.filter((item) => item.type !== "image");
  }
  pluginHost = createPluginHost();
  pluginHost.load();
  createWindows();
  applyLoginItemSettings();
  syncTrayVisibility();
  registerShortcuts();
  startClipboardMonitor();
  if (runtime.state.config.showManagerOnStartup) {
    showManager();
  }
});

app.on("will-quit", () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
});


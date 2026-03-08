"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("clipx", {
  getState: () => ipcRenderer.invoke("state:get"),
  selectClip: (clipId) => ipcRenderer.invoke("clip:select", clipId),
  togglePin: (clipId) => ipcRenderer.invoke("clip:pin-toggle", clipId),
  createPinnedText: (payload) => ipcRenderer.invoke("pinned:create-text", payload),
  createPinnedFromClipboard: () => ipcRenderer.invoke("pinned:create-from-clipboard"),
  updatePinned: (payload) => ipcRenderer.invoke("pinned:update", payload),
  removePinned: (clipId) => ipcRenderer.invoke("pinned:remove", clipId),
  deleteClip: (clipId) => ipcRenderer.invoke("clip:delete", clipId),
  clearHistory: () => ipcRenderer.invoke("history:clear"),
  clearClipboard: () => ipcRenderer.invoke("clipboard:clear"),
  toggleMonitoring: () => ipcRenderer.invoke("monitoring:toggle"),
  previewSound: (soundFile) => ipcRenderer.invoke("settings:preview-sound", soundFile),
  pickSoundFile: () => ipcRenderer.invoke("settings:pick-sound-file"),
  updateSettings: (config) => ipcRenderer.invoke("settings:update", config),
  saveCollection: (payload) => ipcRenderer.invoke("collection:save", payload),
  loadCollection: (collectionId) => ipcRenderer.invoke("collection:load", collectionId),
  removeCollection: (collectionId) => ipcRenderer.invoke("collection:remove", collectionId),
  openFile: (value) => ipcRenderer.invoke("item:open", value),
  searchWeb: (query) => ipcRenderer.invoke("item:search-web", query),
  openUrl: (url) => ipcRenderer.invoke("item:open-url", url),
  showImagePreview: (payload) => ipcRenderer.send("preview:show", payload),
  hideImagePreview: () => ipcRenderer.send("preview:hide"),
  onStateUpdated: (callback) => ipcRenderer.on("state:updated", (_, state) => callback(state)),
  onFocusSearch: (callback) => ipcRenderer.on("view:focus-search", callback),
  onSelectionActivated: (callback) => ipcRenderer.on("selection:activated", (_, clipId) => callback(clipId)),
  onSetTab: (callback) => ipcRenderer.on("view:set-tab", (_, tab) => callback(tab)),
  onPreviewUpdate: (callback) => ipcRenderer.on("preview:update", (_, payload) => callback(payload)),
  onSoundPlay: (callback) => ipcRenderer.on("sound:play", (_, payload) => callback(payload))
});

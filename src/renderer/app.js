"use strict";

const params = new URLSearchParams(window.location.search);
const currentView = params.get("view") || "manager";

const state = {
  app: null,
  currentTab: "settings",
  search: "",
  selectedIds: [],
  activeClipId: null,
  pinnedEditor: {
    id: null,
    title: "",
    text: ""
  }
};

function byId(id) {
  return document.getElementById(id);
}

function formatDate(value) {
  return new Date(value).toLocaleString("zh-CN");
}

function escapeHtml(value) {
  return (value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clipSummary(item) {
  if (item.type === "text") {
    return escapeHtml((item.text || "").slice(0, currentView === "popup" ? 120 : 220));
  }
  if (item.type === "files") {
    return escapeHtml((item.files || []).join("\n"));
  }
  return "图像剪贴板";
}

function popupRowLabel(item) {
  if (item.type === "image") {
    return '<span class="popup-kind popup-kind-image">图像</span>';
  }
  if (item.type === "files") {
    return '<span class="popup-kind popup-kind-file">文件</span>';
  }
  return "";
}

function popupSlotLabel(index) {
  return index === 9 ? "(0)" : `(${index + 1})`;
}

function pinnedShortcutLabel(index) {
  const digit = index === 9 ? "0" : String(index + 1);
  return `Ctrl+${digit}`;
}

function findPopupItemById(clipId) {
  const items = [...(state.app?.history || []), ...(state.app?.pinned || [])];
  return items.find((item) => item.id === clipId) || null;
}

function visibleItems() {
  if (!state.app) {
    return [];
  }

  if (state.currentTab === "collections") {
    return state.app.collections;
  }
  if (state.currentTab === "settings") {
    return [];
  }

  const source = state.currentTab === "pinned" ? state.app.pinned : state.app.history;
  const query = state.search.trim().toLowerCase();
  if (!query) {
    return source;
  }
  return source.filter((item) => JSON.stringify(item).toLowerCase().includes(query));
}

function renderSidebar() {
  return `
    <div class="sidebar">
      <p class="section-title">视图</p>
      <div class="tab-list">
        ${["history", "pinned", "collections", "settings"].map((tab) => `
          <button class="tab-button ${state.currentTab === tab ? "active" : ""}" data-tab="${tab}">
            ${tab === "history" ? "历史" : tab === "pinned" ? "常驻片段" : tab === "collections" ? "集合" : "设置"}
          </button>
        `).join("")}
      </div>
      <div class="stats">
        <div>历史条目: ${state.app.history.length}</div>
        <div>常驻条目: ${state.app.pinned.length}</div>
        <div>集合数量: ${state.app.collections.length}</div>
        <div>监听状态: ${state.app.monitoringPaused ? "已暂停" : "运行中"}</div>
        <div>快捷粘贴: Ctrl+1 到 Ctrl+0 对应前 10 个常驻条目</div>
      </div>
    </div>
  `;
}

function renderClipCard(item) {
  const pinned = state.app.pinned.some((entry) => entry.id === item.id);
  const pinnedIndex = state.app.pinned.findIndex((entry) => entry.id === item.id);
  const shortcutHint = pinnedIndex > -1 && pinnedIndex < 10 ? ` · ${pinnedShortcutLabel(pinnedIndex)}` : "";
  const pinnedActions = state.currentTab === "pinned"
    ? `
        <button class="ghost-button" data-action="pinned-edit" data-id="${item.id}">编辑</button>
        <button class="ghost-button" data-action="pinned-remove" data-id="${item.id}">删除</button>
      `
    : "";

  return `
    <div class="clip-card ${state.activeClipId === item.id ? "active" : ""}" data-clip="${item.id}">
      <div class="clip-card-title">
        <span>${escapeHtml(item.title)}</span>
        <span class="muted">${item.type}${shortcutHint}</span>
      </div>
      <div class="clip-meta">${formatDate(item.createdAt)}</div>
      <div class="clip-body">${clipSummary(item)}</div>
      <div class="inline-actions">
        <button class="ghost-button" data-action="pin" data-id="${item.id}">${pinned ? "取消常驻" : "设为常驻"}</button>
        <button class="ghost-button" data-action="copy" data-id="${item.id}">复制并粘贴</button>
        <button class="ghost-button" data-action="toggle-select" data-id="${item.id}">${state.selectedIds.includes(item.id) ? "取消选中" : "加入集合"}</button>
        <button class="ghost-button" data-action="delete" data-id="${item.id}">删除</button>
        ${pinnedActions}
      </div>
    </div>
  `;
}

function renderCollectionCard(collection) {
  return `
    <div class="clip-card">
      <div class="clip-card-title">
        <span>${escapeHtml(collection.name)}</span>
        <span class="muted">${collection.items.length} items</span>
      </div>
      <div class="clip-meta">${formatDate(collection.createdAt)}</div>
      <div class="clip-body">${collection.items.map((item) => escapeHtml(item.title)).join("<br>")}</div>
      <div class="inline-actions">
        <button class="ghost-button" data-action="collection-load" data-id="${collection.id}">加载到历史</button>
        <button class="ghost-button" data-action="collection-remove" data-id="${collection.id}">删除集合</button>
      </div>
    </div>
  `;
}

function renderPinnedEditor() {
  const isEditing = Boolean(state.pinnedEditor.id);
  return `
    <div class="clip-card pinned-editor-card">
      <div class="clip-card-title">
        <span>${isEditing ? "编辑常驻片段" : "新建常驻片段"}</span>
        <span class="muted">${isEditing ? "修改后保存" : "文本常驻"}</span>
      </div>
      <div class="field">
        <label for="pinnedTitle">标题</label>
        <input id="pinnedTitle" value="${escapeHtml(state.pinnedEditor.title)}" placeholder="例如：邮箱模板">
      </div>
      <div class="field">
        <label for="pinnedText">内容</label>
        <textarea id="pinnedText" class="pinned-textarea" placeholder="输入常驻内容">${escapeHtml(state.pinnedEditor.text)}</textarea>
      </div>
      <div class="clip-actions">
        <button class="action-button primary" data-action="pinned-save">${isEditing ? "保存修改" : "创建常驻"}</button>
        <button class="action-button" data-action="pinned-create-from-clipboard">从当前剪贴板创建</button>
        ${isEditing ? '<button class="action-button" data-action="pinned-cancel-edit">取消编辑</button>' : ""}
      </div>
    </div>
  `;
}

function renderSettings() {
  return `
    <div class="main">
      <p class="section-title">配置</p>
      <div class="settings-grid">
        <div class="field"><label for="maxHistory">历史条目上限</label><input id="maxHistory" type="number" min="10" max="500" value="${state.app.config.maxHistory}"></div>
        <div class="field"><label for="pollIntervalMs">监听轮询间隔(ms)</label><input id="pollIntervalMs" type="number" min="200" max="2000" step="100" value="${state.app.config.pollIntervalMs}"></div>
        <div class="field"><label for="pasteStrategy">粘贴方式</label><select id="pasteStrategy"><option value="ctrl-v" ${state.app.config.pasteStrategy === "ctrl-v" ? "selected" : ""}>Ctrl+V</option><option value="shift-insert" ${state.app.config.pasteStrategy === "shift-insert" ? "selected" : ""}>Shift+Insert</option></select></div>
        <div class="field"><label for="togglePopupKey">快速面板热键</label><input id="togglePopupKey" value="${state.app.config.hotkeys.togglePopup}"></div>
        <div class="field"><label for="openManagerKey">管理器热键</label><input id="openManagerKey" value="${state.app.config.hotkeys.openManager}"></div>
      </div>
      <div class="inline-actions">
        <label><input id="ignoreText" type="checkbox" ${state.app.config.ignoreText ? "checked" : ""}> 忽略文本</label>
        <label><input id="ignoreImages" type="checkbox" ${state.app.config.ignoreImages ? "checked" : ""}> 忽略图像</label>
        <label><input id="ignoreFiles" type="checkbox" ${state.app.config.ignoreFiles ? "checked" : ""}> 忽略文件</label>
        <label><input id="autoPaste" type="checkbox" ${state.app.config.autoPaste ? "checked" : ""}> 选择后自动粘贴</label>
      </div>
      <div class="clip-actions" style="margin-top:18px;">
        <button class="action-button primary" data-action="save-settings">保存设置</button>
        <button class="action-button" data-action="toggle-monitoring">${state.app.monitoringPaused ? "恢复监听" : "暂停监听"}</button>
        <button class="action-button" data-action="clear-history">清空历史</button>
        <button class="action-button" data-action="clear-clipboard">清空当前剪贴板</button>
      </div>
    </div>
  `;
}

function renderPopupList() {
  const historyItems = state.app.history.slice(0, 25);
  const pinnedItems = state.app.pinned.slice(0, 26);
  const scrollClass = state.app.popupScrollEnabled ? "popup-scroll" : "";

  return `
    <div class="main ${scrollClass}">
      <div class="popup-list">
        ${historyItems.map((item, index) => `
          <div class="popup-row ${state.activeClipId === item.id ? "active" : ""} ${item.type === "image" ? "popup-row-image" : ""}" data-clip="${item.id}">
            <div class="popup-row-text">${popupRowLabel(item)}${escapeHtml(item.title)}</div>
            <div class="popup-row-slot">${popupSlotLabel(index)}</div>
          </div>
        `).join("")}
        ${pinnedItems.length ? '<div class="popup-divider"></div>' : ""}
        ${pinnedItems.map((item, index) => `
          <div class="popup-row ${state.activeClipId === item.id ? "active" : ""} ${item.type === "image" ? "popup-row-image" : ""}" data-clip="${item.id}">
            <div class="popup-row-text">${popupRowLabel(item)}${escapeHtml(item.title)}</div>
            <div class="popup-row-slot">${index < 10 ? pinnedShortcutLabel(index) : ""}</div>
          </div>
        `).join("")}
        ${!historyItems.length && !pinnedItems.length ? '<div class="empty">还没有剪贴板历史。</div>' : ""}
      </div>
    </div>
  `;
}

function renderMain() {
  if (currentView === "popup") {
    return renderPopupList();
  }
  if (state.currentTab === "settings") {
    return renderSettings();
  }
  if (state.currentTab === "pinned") {
    const items = visibleItems();
    return `
      <div class="main">
        ${renderPinnedEditor()}
        <div class="list">${items.length ? items.map(renderClipCard).join("") : '<div class="empty">还没有常驻片段。</div>'}</div>
      </div>
    `;
  }
  if (state.currentTab === "collections") {
    const collections = visibleItems();
    return `<div class="main"><div class="clip-actions" style="margin-bottom:18px;"><button class="action-button primary" data-action="save-collection">将已选条目保存为集合</button></div><div class="list">${collections.length ? collections.map(renderCollectionCard).join("") : '<div class="empty">还没有保存的集合。</div>'}</div></div>`;
  }

  const items = visibleItems();
  return `<div class="main"><div class="list">${items.length ? items.map(renderClipCard).join("") : '<div class="empty">没有匹配的剪贴板记录。</div>'}</div></div>`;
}

function render() {
  const app = byId("app");
  document.body.className = currentView === "popup" ? "popup-body" : "";

  if (!state.app) {
    app.innerHTML = '<div class="shell"><div class="chrome"><div class="empty">正在加载...</div></div></div>';
    return;
  }

  app.innerHTML = `
    <div class="shell ${currentView === "popup" ? "popup" : ""}">
      <div class="chrome">
        <div class="topbar">
          <div class="brand"><strong>${state.app.appName}</strong><span>ClipX 风格的 Windows 剪贴板管理器</span></div>
          <div class="toolbar"><input id="searchInput" class="search" placeholder="搜索历史、文件名或文本片段" value="${escapeHtml(state.search)}"></div>
        </div>
        <div class="layout">${currentView === "popup" ? "" : renderSidebar()}${renderMain()}</div>
      </div>
    </div>
  `;

  wireEvents();
}

function readSettingsForm() {
  return {
    maxHistory: Number(byId("maxHistory").value),
    pollIntervalMs: Number(byId("pollIntervalMs").value),
    pasteStrategy: byId("pasteStrategy").value,
    ignoreText: byId("ignoreText").checked,
    ignoreImages: byId("ignoreImages").checked,
    ignoreFiles: byId("ignoreFiles").checked,
    autoPaste: byId("autoPaste").checked,
    hotkeys: {
      togglePopup: byId("togglePopupKey").value.trim(),
      openManager: byId("openManagerKey").value.trim()
    }
  };
}

function readPinnedForm() {
  return {
    id: state.pinnedEditor.id,
    title: byId("pinnedTitle")?.value.trim() || "",
    text: byId("pinnedText")?.value || ""
  };
}

async function handleAction(button) {
  const { action, id, value } = button.dataset;

  if (action === "copy") {
    await window.clipx.selectClip(id);
  } else if (action === "pin") {
    await window.clipx.togglePin(id);
  } else if (action === "delete") {
    await window.clipx.deleteClip(id);
  } else if (action === "toggle-select") {
    state.selectedIds = state.selectedIds.includes(id)
      ? state.selectedIds.filter((entry) => entry !== id)
      : [...state.selectedIds, id];
    render();
  } else if (action === "save-collection") {
    if (!state.selectedIds.length) {
      window.alert("先选择至少一条记录。");
      return;
    }
    const name = window.prompt("集合名称", `Collection ${new Date().toLocaleTimeString("zh-CN")}`);
    if (name) {
      await window.clipx.saveCollection({ name, itemIds: state.selectedIds });
      state.selectedIds = [];
    }
  } else if (action === "collection-load") {
    await window.clipx.loadCollection(id);
  } else if (action === "collection-remove") {
    await window.clipx.removeCollection(id);
  } else if (action === "save-settings") {
    await window.clipx.updateSettings(readSettingsForm());
  } else if (action === "toggle-monitoring") {
    await window.clipx.toggleMonitoring();
  } else if (action === "clear-history") {
    await window.clipx.clearHistory();
  } else if (action === "clear-clipboard") {
    await window.clipx.clearClipboard();
  } else if (action === "pinned-save") {
    const payload = readPinnedForm();
    if (!payload.text.trim()) {
      window.alert("常驻内容不能为空。");
      return;
    }
    if (payload.id) {
      const result = await window.clipx.updatePinned(payload);
      if (!result?.ok) {
        window.alert("保存失败。");
        return;
      }
    } else {
      const result = await window.clipx.createPinnedText(payload);
      if (!result?.ok) {
        window.alert("创建失败。");
        return;
      }
    }
    state.pinnedEditor = { id: null, title: "", text: "" };
  } else if (action === "pinned-create-from-clipboard") {
    const result = await window.clipx.createPinnedFromClipboard();
    if (!result?.ok) {
      window.alert("当前剪贴板没有可用内容。");
    }
  } else if (action === "pinned-edit") {
    const item = (state.app.pinned || []).find((entry) => entry.id === id);
    if (!item) {
      return;
    }
    state.pinnedEditor = {
      id,
      title: item.title || "",
      text: item.type === "text" ? (item.text || "") : ""
    };
    render();
  } else if (action === "pinned-remove") {
    await window.clipx.removePinned(id);
    if (state.pinnedEditor.id === id) {
      state.pinnedEditor = { id: null, title: "", text: "" };
    }
  } else if (action === "pinned-cancel-edit") {
    state.pinnedEditor = { id: null, title: "", text: "" };
    render();
  } else if (action === "search-web") {
    await window.clipx.searchWeb(value);
  } else if (action === "open-url") {
    await window.clipx.openUrl(value);
  } else if (action === "open-file") {
    await window.clipx.openFile(value);
  }
}

function showPopupImagePreview(item, anchorEl) {
  if (!anchorEl || !item || item.type !== "image" || !item.imageDataUrl) {
    return;
  }
  const anchorRect = anchorEl.getBoundingClientRect();
  window.clipx.showImagePreview({
    title: item.title,
    imageDataUrl: item.imageDataUrl,
    anchorRect: {
      left: Math.round(window.screenX + anchorRect.left),
      top: Math.round(window.screenY + anchorRect.top),
      right: Math.round(window.screenX + anchorRect.right),
      bottom: Math.round(window.screenY + anchorRect.bottom)
    }
  });
}

function hidePopupImagePreview() {
  window.clipx.hideImagePreview();
}

function wireEvents() {
  const input = byId("searchInput");
  if (input && currentView !== "popup") {
    input.addEventListener("input", (event) => {
      state.search = event.target.value;
      render();
    });
  }

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.currentTab = button.dataset.tab;
      render();
    });
  });

  document.querySelectorAll("[data-clip]").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest("button")) {
        return;
      }
      state.activeClipId = card.dataset.clip;
      render();
      if (currentView === "popup") {
        window.clipx.selectClip(card.dataset.clip);
      }
    });
    if (currentView === "popup") {
      card.addEventListener("mouseenter", () => {
        const item = findPopupItemById(card.dataset.clip);
        if (item && item.type === "image") {
          showPopupImagePreview(item, card);
        } else {
          hidePopupImagePreview();
        }
      });
      card.addEventListener("mouseleave", () => {
        hidePopupImagePreview();
      });
    }
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleAction(button));
  });
}

async function init() {
  state.app = await window.clipx.getState();
  state.activeClipId = state.app.history[0]?.id || state.app.pinned[0]?.id || null;
  render();

  window.clipx.onStateUpdated((nextState) => {
    state.app = nextState;
    if (state.currentTab !== "pinned" || !state.pinnedEditor.id) {
      state.pinnedEditor = state.pinnedEditor.id ? state.pinnedEditor : { id: null, title: "", text: "" };
    }
    render();
  });

  window.clipx.onFocusSearch(() => {
    const input = byId("searchInput");
    if (input && currentView !== "popup") {
      input.focus();
      input.select();
    }
  });

  window.clipx.onSetTab((tab) => {
    state.currentTab = tab;
    render();
  });
}

init();

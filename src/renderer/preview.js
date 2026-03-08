"use strict";

function byId(id) {
  return document.getElementById(id);
}

window.clipx.onPreviewUpdate((payload) => {
  byId("previewTitle").textContent = payload.title || "图片预览";
  byId("previewImage").src = payload.imageDataUrl || "";
});

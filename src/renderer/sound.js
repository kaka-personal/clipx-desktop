"use strict";

const audio = new Audio();
audio.preload = "auto";
audio.volume = 1;

window.clipx.onSoundPlay((payload) => {
  if (!payload?.soundUrl) {
    return;
  }

  audio.pause();
  audio.currentTime = 0;
  audio.src = `${payload.soundUrl}?t=${Date.now()}`;
  audio.play().catch(() => {});
});

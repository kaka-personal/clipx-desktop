# ClipX Desktop

一个模仿 ClipX 的 Windows 桌面剪贴板管理器，使用 Electron 实现。

## 已实现功能

- 托盘常驻与最近历史菜单
- 全局热键打开快速面板与管理器
- 文本、图像、文件列表三类剪贴板历史
- 搜索、预览、重新复制并自动粘贴
- 常驻片段（Pinned / Sticky clips）
- 集合保存、加载、删除
- 基础配置：历史条数、监听频率、忽略类型、粘贴方式、热键
- 插件目录预留：`%APPDATA%/clipx-desktop/plugins`

## 启动

```powershell
npm install
npm start
```

## 说明

- 默认热键:
  - 快速面板: `Ctrl+Shift+V`
  - 管理器: `Ctrl+Shift+H`
- 自动粘贴通过 Windows `SendKeys` 发送 `Ctrl+V` 或 `Shift+Insert`，某些提权窗口可能无法接收。

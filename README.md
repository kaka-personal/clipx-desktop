# ClipX Desktop

ClipX Desktop 是一个面向 Windows 的剪贴板管理工具，灵感来自经典的 ClipX，使用 Electron 构建。

本项目目标不是逐字节复刻老版 ClipX，而是在现代 Windows 环境下提供接近 ClipX 使用体验的开源实现。

## 特性

- 托盘常驻
- 左键打开快速历史列表
- 右键打开设置菜单
- 文本、图片、文件列表剪贴板历史
- 常驻片段管理
- `Ctrl+1` 到 `Ctrl+0` 快速粘贴前 10 个常驻条目
- 图片条目悬停预览
- 搜索、删除、重新复制
- 集合保存与加载
- 剪贴板监听设置
- 提示音设置
- 托盘图标切换
- Windows 安装版与便携版打包

## 截图说明

当前仓库未单独整理截图资源，如需展示图，可从运行中的应用自行补充到仓库。

## 开发环境

- Windows 10 / 11
- Node.js 18+
- npm

## 本地启动

```powershell
npm install
npm start
```

## 打包

生成 Windows 安装版：

```powershell
npm run dist:setup
```

生成便携版：

```powershell
npm run dist
```

打包产物默认输出到 `dist/`。

## 默认热键

- 快速面板：`Ctrl+Shift+V`
- 管理器：`Ctrl+Shift+H`

## 用户数据目录

应用运行后会将配置和历史数据保存到用户目录：

```text
C:\Users\<用户名>\AppData\Roaming\clipx-desktop
```

## 项目结构

```text
assets/         图标、声音等静态资源
build/          打包阶段脚本
src/main.js     Electron 主进程
src/preload.js  预加载桥接
src/renderer/   界面层
```

## 开源协议

本项目使用 `MIT License`。

这意味着你可以：

- 商用
- 修改
- 分发
- 私有使用

你需要保留原始版权声明和许可证文本。

如果你希望未来增加更强的专利保护或更明确的企业使用条款，可以再改成 Apache-2.0，但当前这个项目更适合从 MIT 起步。

## 贡献

欢迎提交 Issue 和 PR。

提交代码前建议至少完成以下检查：

- 能正常启动
- 核心交互未回归
- Windows 打包可以通过

## 声明

- 本项目仅为“受 ClipX 启发的开源实现”。
- 本项目与原版 ClipX 无官方关联。
- `ClipX` 相关名称、历史软件及其权利归原作者或相关权利方所有。

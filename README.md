# Tabby Mingze 在线编辑器

`tabby-mingze-online-editor` 是一个 Tabby 插件，用来把 SFTP 远端文件直接打开到 Tabby 内编辑、预览和保存。它不是“下载到本地改完再传回去”的工作流，而是把远端文件直接变成 Tabby 里的一个可操作标签页。

如果你平时已经在 Tabby 里连 SSH，这个插件解决的是最后一段体验缺口: 远端文件打开、修改、预览、保存、目录切换、上传下载，尽量都在同一个界面里完成。

![插件界面预览](./QQ20260415-013331.jpg)

## 插件特色

- 直接从 SFTP 文件右键进入编辑器，少一次下载和外部编辑器切换
- 使用 Monaco 作为编辑器，支持常见语言高亮和基础编辑体验
- 左侧自带远端文件树，可在当前标签或新标签中切换文件
- 内置 Markdown、SVG、PDF 预览，不需要额外打开本地工具
- 保存前检查远端文件是否被修改，冲突时进入 diff 视图而不是静默覆盖
- 支持多种文本编码重新打开和按指定编码保存
- 支持选区翻译和问答，适合阅读英文文档、日志、配置和 PDF

## 适合什么场景

- 在服务器上改配置、脚本、代码片段，不想来回下载文件
- 通过 SFTP 浏览远端项目时，希望像本地编辑器一样快速切换文件
- 查看远端 Markdown、SVG、PDF，又不想离开 Tabby
- 处理中文环境常见的 `GBK`、`GB18030` 等编码文件
- 阅读英文资料时，希望直接对选中文本翻译或提问

## 主要功能

### 远端编辑

- 在 SFTP 文件浏览器的文件右键菜单中显示 `Edit in Tabby`
- 打开后进入 Monaco 标签页
- `Ctrl/Cmd + S` 直接写回远端
- 支持保存、重载、查找、替换、复制、粘贴、全选等常用动作

### 文件树和远端文件操作

- 显示当前目录的远端文件树
- 支持展开目录、刷新目录、返回上级目录
- 支持当前标签打开文件，也支持新标签打开
- 支持复制远端路径
- 支持新建文件、新建文件夹、重命名、删除
- 如果当前 Tabby 构建支持本地文件对话框，还支持上传本地文件到远端，以及把远端文件下载到本地

### 预览能力

- Markdown 支持 `Source / Preview`
- Markdown 预览支持 GFM、KaTeX 数学公式、Mermaid 图表
- SVG 支持 `Source / Preview`
- PDF 直接进入只读预览模式，支持翻页、页码跳转、缩放和 Outline

### 冲突保护

- 保存前会检查远端文件的修改时间
- 如果检测到远端文件已经变化，会进入 Monaco diff 视图
- 提供 `Use local version`、`Use remote version`、`Cancel` 三种处理方式

### 编码支持

- 自动识别 `UTF-8 BOM`、`UTF-16LE BOM`、`UTF-16BE BOM`
- 无 BOM 时会优先尝试 `UTF-8`，然后尝试 `GBK`，最后回退到 `ISO-8859-1`
- 支持重新按指定编码打开
- 支持按指定编码保存
- 当前内置编码包括 `UTF-8`、`GBK`、`GB18030`、`Big5`、`Shift_JIS`、`EUC-KR`、`ISO-8859-1`、`Windows-1252`

### AI 辅助

- 在 Monaco 编辑区、Markdown 预览区、PDF 文本层中选中文本后，可触发 AI
- 提供 `Translate` 和 `Ask` 两种模式
- 支持 OpenAI 兼容接口
- `Auto` 模式会先尝试 `/responses`，明确不支持时再回退到 `/chat/completions`
- Ask 模式支持 `reasoning effort`
- 相同选区和问题会做本地缓存，减少重复请求

## 怎么使用

### 打开文件

1. 在 Tabby 中连接 SSH 并进入 SFTP 文件浏览器
2. 右键一个文件
3. 点击 `Edit in Tabby`
4. 文件会在一个新标签页中打开

### 编辑和保存

1. 像普通编辑器一样修改内容
2. 按 `Ctrl/Cmd + S` 保存
3. 如果远端文件期间被别人改过，插件会切换到冲突对比界面

### 预览文件

- Markdown 文件可以在 `Source` 和 `Preview` 间切换
- SVG 文件可以在源码和图形预览间切换
- PDF 文件会直接以只读预览模式打开

### 使用 AI

1. 选中一段文本
2. 点击浮出的 `AI` 按钮，或者使用编辑器右键菜单中的 AI 项
3. 在 `Translate` 里翻译，或在 `Ask` 里针对选区提问

只有在你显式触发时，选中文本才会发送到外部 AI 接口。单纯选中文本不会自动联网。

## 文件类型与保护策略

- 普通文本文件: 可编辑
- Markdown / SVG: 可编辑，也可预览
- PDF: 只读预览，不支持保存修改
- 二进制文件: 默认阻止编辑，可手动 `Force Open`

大文件策略如下:

- 大于 `1 MB` 时先警告
- 大于 `5 MB` 时只读打开
- 大于 `20 MB` 时拒绝打开

## 安装

这个仓库当前更适合作为源码仓库使用。常见安装方式是从源码构建后放进 Tabby 的插件目录。

### Windows + Node.js 22.22.2

建议使用:

- Node.js `22.22.2`
- Yarn Classic `1.22.x`

先确认 Node 和 npm:

```powershell
node -v
npm -v
```

如果还没有 Yarn:

```powershell
npm install -g yarn
yarn -v
```

进入插件源码目录后安装依赖并构建:

```powershell
yarn install
yarn build
```

日常安装使用可以改用生产构建:

```powershell
yarn build:prod
```

然后把整个项目目录复制到 Tabby 的用户插件目录:

```text
%APPDATA%\Tabby\plugins\tabby-mingze-online-editor
```

也可以用目录联接，方便以后在源码目录重新构建后直接生效。用管理员或有权限的 PowerShell 执行:

```powershell
New-Item -ItemType Directory -Force "$env:APPDATA\Tabby\plugins"
cmd /c mklink /J "$env:APPDATA\Tabby\plugins\tabby-mingze-online-editor" "C:\path\to\tabby-mingze-online-editor"
```

放好后重启 Tabby，或在 Tabby 里重新加载插件。插件目录中应该能直接看到 `package.json` 和 `dist\index.js`。

### Linux / macOS

先安装依赖并构建:

```bash
yarn install
yarn build
```

然后把项目目录复制或软链接到 Tabby 的 Plugins 目录，最后重启或重新加载 Tabby。

## 开发

常用命令:

```bash
yarn build
yarn build:prod
yarn watch
```

说明:

- `yarn build`：开发模式构建
- `yarn build:prod`：生产模式构建
- `yarn watch`：监听源码变化并持续重建

这个插件的核心入口和模块大致如下:

- `src/index.ts`：插件模块入口
- `src/sftpContextMenu.ts`：给 SFTP 右键菜单注入 `Edit in Tabby`
- `src/remoteEditorTab.component.ts`：主编辑器标签页，包含编辑、预览、文件树、保存、冲突处理、AI 等主要逻辑
- `src/translationClient.ts`：AI 请求封装
- `webpack.config.js`：打包配置

## AI 配置说明

首次使用 AI 前，需要在设置面板中配置:

- `API Base URL`
- `API Key`
- `Translation Model`
- `Ask Model`
- `Target Language`
- `Endpoint Mode`
- `Timeout (ms)`
- Ask 的 `reasoning effort`

这些设置会保存在本地 `localStorage`，其中也包括 `API Key`。如果你对本机敏感信息存储有要求，需要自行评估这一点。

## 已知限制

- PDF 仅支持预览，不支持编辑和保存
- Markdown 相对链接暂不支持直接打开
- 上传和下载依赖当前 Tabby 构建是否提供本地文件对话框
- 编码自动识别覆盖的是常见场景，不是完整字符集检测器
- `GBK`、`GB18030`、`Big5`、`Shift_JIS`、`EUC-KR`、`Windows-1252` 等编码保存依赖运行时可用的 `iconv-lite`

## 手动验证建议

- 打开普通文本文件，修改并保存
- 在侧边栏测试目录切换、新建、重命名、删除
- 打开 `.md`、`.svg`、`.pdf` 分别验证预览行为
- 造一个远端并发修改场景，确认冲突处理正常
- 测试编码切换和按编码保存
- 配置 AI 后，测试 `Translate` 和 `Ask`

## License

MIT

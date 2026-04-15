# Tabby Mingze 在线编辑器

`tabby-mingze-online-editor` 是一个 Tabby 插件，用来把 SFTP 远端文件直接打开到 Tabby 内部编辑，而不是先下载到本地再处理。它在 SFTP 文件浏览器的右键菜单里增加 `Edit in Tabby`，随后在一个专用标签页中提供编辑、预览、保存、文件树导航，以及基于选区的 AI 辅助能力。

这个仓库本质上是一个「Tabby + Angular + Monaco + SFTP」的单插件项目。入口文件很薄，真正的业务逻辑几乎都集中在一个远端编辑器组件里。

## 这是什么

这个插件主要解决三类问题：

1. 让远端文本文件能在 Tabby 里直接编辑，而不是在外部编辑器和终端之间来回切换。
2. 让常见预览型文件在同一个标签页里完成查看，比如 Markdown、SVG、PDF。
3. 给远端文件操作补齐一个轻量文件管理器能力，包括目录树、上传、下载、新建、重命名、删除，以及保存冲突处理。

代码层面看，它不是一个“只弹出 Monaco 编辑器”的简单插件，而是一个完整的远端文件工作台。

## 用户能得到什么

### 核心编辑体验

- 在 SFTP 文件右键菜单中显示 `Edit in Tabby`
- 远端文件在 Tabby 新标签页中打开
- 使用 Monaco 作为编辑器，支持常见语言高亮
- `Ctrl/Cmd + S` 直接保存到远端
- 右键菜单补充了保存、重载、查找/替换、复制粘贴、按编码重开、按编码保存等动作

### 文件树与远端文件操作

- 侧边栏显示当前目录的远端文件树
- 支持展开目录、刷新目录、返回上级目录
- 支持当前标签打开或新标签打开其他文件
- 支持复制远端路径
- 支持新建文件、新建文件夹、重命名、删除
- 如果当前 Tabby 构建提供本地文件选择器，还支持上传本地文件到远端、把远端文件下载到本地

### 预览能力

- Markdown：`Source / Preview` 双模式
- Markdown 预览链路包含 GFM、数学公式、Mermaid 图表
- SVG：`Source / Preview` 双模式，预览前会做清理和安全处理
- PDF：进入只读预览模式，支持翻页、页码跳转、缩放、Outline 跳转

### 安全与保护逻辑

- 大于 `1 MB` 的文件会先给出打开警告
- 大于 `5 MB` 的文件以只读方式打开
- 大于 `20 MB` 的文件拒绝打开
- 二进制内容默认阻止编辑，但可以手动 `Force Open`
- 保存前检查远端 `mtime`，发现并发修改后进入 diff 冲突视图

### 编码处理

- 自动识别 `UTF-8 BOM`、`UTF-16LE BOM`、`UTF-16BE BOM`
- 无 BOM 时自动尝试 `UTF-8`，失败后尝试 `GBK`，最后回退到 `ISO-8859-1`
- 支持用指定编码重新打开
- 支持按指定编码保存
- 当前编码列表包括 `UTF-8`、`GBK`、`GB18030`、`Big5`、`Shift_JIS`、`EUC-KR`、`ISO-8859-1`、`Windows-1252`

### AI 辅助

- 在 Monaco 编辑区、Markdown 预览区、PDF 文本层中选中文本后，可触发 AI 按钮
- 提供 `Translate` 和 `Ask` 两种模式
- 支持 OpenAI 兼容接口
- `Auto` 模式下先尝试 `/responses`，失败后按错误类型回退到 `/chat/completions`
- 结果带本地缓存，同一选区重复请求会复用缓存
- Ask 模式支持 `reasoning effort`

## 仓库怎么组织

### 关键文件

- `src/index.ts`
  - Angular 模块入口
  - 在 Monaco 被加载前设置 `__webpack_public_path__`
  - 这是这个项目最容易被误改坏的地方之一，因为 Monaco worker 和资源路径依赖它

- `src/sftpContextMenu.ts`
  - 向 Tabby 的 SFTP 面板注入 `Edit in Tabby`
  - 从面板对象里拿到运行时 SSH session
  - 创建远端编辑器标签页并把文件路径、名字、权限、大小传进去

- `src/remoteEditorTab.component.ts`
  - 整个仓库的核心
  - 负责文件读取、写回、冲突检测、目录树、上传下载、Monaco 生命周期、Markdown/SVG/PDF 预览、主题同步、编码切换、AI 交互、右键菜单、剪贴板桥接等几乎所有能力
  - 这也是维护成本最高的文件

- `src/remoteEditorTab.component.pug`
  - 远端编辑器标签页模板
  - 定义工具栏、侧边栏、预览区、AI 浮层、AI 设置弹窗、递归文件树、PDF Outline 树

- `src/translationClient.ts`
  - 独立的 AI 请求客户端
  - 负责构造系统提示词、调用 `/responses` 或 `/chat/completions`、解析响应、超时控制、自动回退、错误包装

- `src/shims-tabby.d.ts`
  - 这不是业务代码
  - 它的作用是让本仓库在不依赖完整 Tabby 源码的情况下也能通过 TypeScript 构建

- `src/markdownPreviewMath.css`
  - KaTeX 数学公式预览的小范围样式修正

- `src/markdownPreviewMermaid.css`
  - Mermaid 图表容器样式

- `webpack.config.js`
  - 打包入口和输出
  - 通过 `MonacoEditorWebpackPlugin` 打包 Monaco
  - 让 KaTeX 字体以内联资源方式进入 bundle
  - 把 `@angular/*`、`rxjs`、`tabby-*` 等依赖视为运行时 external

- `tsconfig.json`
  - TypeScript 编译配置
  - 会额外产出 `dist/index.d.ts`

- `dist/`
  - 构建产物目录
  - 最终发布包只包含这里

## 代码主流程

### 1. 从 SFTP 右键进入编辑器

`src/sftpContextMenu.ts` 会检查当前项是不是文件。只有文件会显示 `Edit in Tabby`，目录不会显示。点击后它会：

1. 从 SFTP 面板拿到运行时 `sshSession`
2. 调用 `sshSession.ref()`，避免会话提前被释放
3. 通过 `AppService.openNewTabRaw` 打开 `RemoteEditorTabComponent`

### 2. 标签页初始化

`src/remoteEditorTab.component.ts` 在 `ngOnInit()` 里会做这些事：

1. 根据文件名推断语言类型
2. 从 `localStorage` 恢复 AI 配置、主题设置、侧边栏状态和宽度
3. 启动主题跟随逻辑
4. 加载当前目录文件树
5. 绑定 AI 浮层相关的全局事件
6. 调用 `loadCurrentFile()` 读取当前文件

### 3. 读取远端文件

读取逻辑走 SFTP `open(..., OPEN_READ)`，循环 `read()` 直到 EOF，把所有块拼成 `Buffer`。

在真正进入编辑器前，组件会先判断：

- 文件是否过大
- 是否需要只读
- 是否看起来像 PDF
- 是否看起来像 SVG
- 是否是二进制内容
- 当前应当使用什么编码去解码

### 4. 渲染成哪种界面

同一个标签页根据文件类型切换为三种模式之一：

- 普通文本：Monaco 编辑器
- Markdown / SVG：Monaco 编辑器 + 可切换预览
- PDF：直接进入 PDF 只读预览，不走可编辑模式

### 5. 保存策略

保存不是直接覆盖原文件，而是：

1. 先检查远端 `mtime`
2. 如果远端已经变化，进入 Monaco diff 视图
3. 如果没有冲突，把内容写到临时路径 `*.tabby-online-edit`
4. 删除原文件并把临时文件 rename 回原路径
5. 尝试恢复原权限位

这个策略的目的是降低半写入状态和冲突覆盖的风险。

## 远端编辑器组件里实际做了什么

`src/remoteEditorTab.component.ts` 很大，但职责基本可以拆成下面几块。

### Monaco 编辑器

- 懒加载 Monaco，避免 `publicPath` 时机错误
- 注册多种基础语言支持
- 注册 JSON 格式化器
- 非 JSON 格式在触发格式化时只给出“不支持”的通知
- 自己接管右键菜单和部分剪贴板行为，以适应 Tabby/Electron 运行环境

### 目录树与远端文件管理

- 目录树节点按“目录优先 + 文件名排序”
- 目录支持懒加载和局部刷新
- 文件切换前会处理脏状态
- 删除目录走递归删除
- 上传会先检查是否覆盖已有文件
- 下载与上传都依赖 Electron 对话框能力

### Markdown 预览

- 用 `unified` + `remark-parse` + `remark-gfm` + `remark-math` + `remark-rehype` + `rehype-katex` + `rehype-stringify`
- 预览 HTML 会先过 DOMPurify 风格的清理逻辑
- Mermaid 代码块会在渲染后替换成安全处理后的 SVG
- 外部链接可打开
- 相对链接当前不支持

### SVG 预览

- 会先做清理，再解析为 DOM，再做额外的 SVG 树加固
- 会拦截不安全的 URL 引用和样式内容
- 预览最终以 `data:image/svg+xml` 的方式注入

### PDF 预览

- 使用 `pdfjs-dist`
- 页面本体渲染到 `canvas`
- 文本层单独叠加，既能选中文本，也能给 AI 功能复用
- 支持 Outline 解析、跳页和定位
- 缩放范围固定在 `50%` 到 `300%`

### 编码与二进制保护

- BOM 保留策略：如果原文件带 BOM，且保存编码未变化，会把 BOM 一起写回
- 读文件时优先做自动识别
- 写文件时 `GBK` / `GB18030` / `Big5` / `Shift_JIS` / `EUC-KR` / `Windows-1252` 等依赖 `iconv-lite`
- 二进制内容默认阻止编辑，但用户可以强制打开

### AI 浮层

- 选区来源可以是 `monaco`、`markdown`、`pdf`
- PDF 选区会做额外归一化，尽量把换行断词拼回可读文本
- 请求前会做长度限制，当前最大 `4000` 字符
- 浮层支持拖拽和缩放
- 翻译与问答结果分别缓存

## AI 配置与数据流

### 需要配置什么

在 AI 设置里需要提供：

- `API Base URL`
- `API Key`
- `Translation Model`
- `Ask Model`
- `Target Language`
- `Endpoint Mode`
- `Timeout (ms)`
- Ask 的 `reasoning effort`

默认模型是 `gpt-5.4-nano`，目标语言默认是 `Simplified Chinese`。

### 请求是怎么发的

`src/translationClient.ts` 负责所有 AI 请求，逻辑是：

1. 组装系统提示词
2. 拼接用户选区或“选区 + 问题”
3. 发到 `/responses` 或 `/chat/completions`
4. 提取文本结果
5. 包装错误并做超时控制

### `Auto` 模式的行为

`Auto` 并不是无条件重试。它会先打 `/responses`，只有在“像是接口不支持”的错误下才回退到 `/chat/completions`。像 `401`、`403`、`429` 这类问题不会回退。

### 数据什么时候会被发出去

只有在你显式触发时才会发送：

- 点击 `Translate`
- 点击 `Ask`
- 在 Ask 面板里真正提交问题

单纯选中文本不会自动联网。

### 本地存储

这些数据会保存在 `localStorage`：

- AI 配置
- API Key
- 主题跟随与亮暗模式
- 侧边栏显示状态与宽度
- 最近一次本地上传/下载目录

如果你对本机敏感信息管理要求较高，需要自己评估 `localStorage` 存储 API Key 是否可接受。

## 构建与开发

先安装依赖：

```bash
yarn install
```

常用命令：

```bash
yarn build
yarn build:prod
yarn watch
```

说明：

- `yarn build`：开发模式构建
- `yarn build:prod`：生产模式构建
- `yarn watch`：监听源码变化并持续重建

## 如何安装到 Tabby

这个仓库更像“插件源码仓库”而不是“Tabby 内置插件仓库”。常见安装方式是：

1. 在本仓库执行 `yarn install`
2. 执行 `yarn build`
3. 把项目目录复制或软链接到 Tabby 的 Plugins 目录
4. 重启或重新加载 Tabby

打包后真正被发布的只有 `dist/`，因为 `package.json` 的 `files` 只包含这个目录。

## 运行时依赖和打包约束

这个项目有几个关键约束，维护时最好先知道：

- Tabby 在运行时提供 `@angular/*`、`rxjs`、`tabby-core`、`tabby-ssh`
- 这些依赖在本项目里被当成 `peerDependencies` 和 `externals`
- Webpack 输出目标是 `node`
- 输出格式是 `umd`
- Monaco 的 worker/静态资源依赖 `src/index.ts` 里提前设置的 `file://` 公共路径
- KaTeX 字体被内联进 bundle，避免运行时走额外字体文件请求

如果把这些约束改坏，最常见的结果是：插件能编译，但在 Tabby 里加载失败，或者 Monaco worker 无法启动。

## 手动测试建议

这个仓库当前没有自动化测试。改动后建议至少手动验证下面这些场景：

- 在 SFTP 面板里右键普通文件，确认出现 `Edit in Tabby`
- 打开文本文件后修改并保存，确认远端内容已更新
- 打开目录树，验证展开、刷新、返回上级、当前标签打开、新标签打开
- 测试新建文件、新建文件夹、重命名、删除
- 若当前 Tabby 构建支持 Electron 对话框，验证上传和下载
- 对同一远端文件制造并发修改，确认会进入 diff 冲突视图
- 打开 `.md` 文件，验证 Source/Preview、KaTeX、Mermaid、外链打开
- 打开 `.svg` 文件，验证 Source/Preview 和异常 SVG 的报错行为
- 打开 `.pdf` 文件，验证翻页、跳页、缩放、Outline、文本选择
- 测试编码切换与按编码保存
- 在 Monaco、Markdown、PDF 三种选区来源下分别测试 `Translate` 和 `Ask`

## 已知限制

- PDF 是只读预览，不能保存修改
- 相对 Markdown 链接目前不支持
- JSON 之外没有真正的文档格式化器
- 上传/下载取决于当前 Tabby 构建是否暴露本地文件选择与保存对话框
- 编码自动识别只覆盖了有限场景，不是完整字符集探测器
- 主逻辑几乎都在 `src/remoteEditorTab.component.ts`，后续维护和拆分成本偏高

## 适合继续优化的方向

如果后面准备继续维护，这个仓库最值得继续做的事情通常有这些：

- 把 `RemoteEditorTabComponent` 按“文件树 / 预览 / AI / SFTP IO / Monaco 集成”拆模块
- 为编码、二进制识别、路径处理、AI 请求回退补单元测试
- 为上传/下载/冲突保存补更明确的错误提示
- 把 Markdown / SVG / PDF 预览能力做成更清晰的内部子模块
- 如果准备长期维护，可以考虑补最小化的集成测试或冒烟测试

## License

MIT

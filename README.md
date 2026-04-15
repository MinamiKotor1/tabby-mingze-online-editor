# Tabby Mingze 在线编辑器

`tabby-mingze-online-editor` 是一个 Tabby 插件。它会在 SFTP 文件浏览器的文件右键菜单中增加 **Edit in Tabby**，把远端文件直接打开到 Tabby 内的 Monaco 标签页中。

## 概览

这个插件面向 SFTP 远端文件的查看、预览和编辑。核心流程很直接，先在 SFTP 面板里右键文件，选择 **Edit in Tabby**，再在 Tabby 内完成打开、修改、保存，以及同目录文件切换。并不是所有远端文件都能直接编辑，二进制文件、大文件和 PDF 会按实现中的保护或预览逻辑处理。

## 主要能力

* **SFTP 入口**：`Edit in Tabby` 只出现在 SFTP 文件项上，目录项不会显示这个菜单。
* **Monaco 标签页**：远端文件在新标签页中打开，支持常见语言的语法高亮，`Ctrl/Cmd+S` 可保存。
* **侧边栏文件树**：支持展开目录、刷新目录、返回上级目录、在当前标签打开文件、在新标签打开文件，以及复制远端路径。
* **侧边栏文件操作**：支持新建文件、新建文件夹、重命名、删除。若当前 Tabby 构建提供本地文件选择与保存对话框，也支持上传本地文件到当前目录或指定目录，以及把远端文件下载到本地。
* **冲突处理**：保存前会检查远端文件是否已变化。若检测到冲突，会进入 Monaco diff 视图，并提供 **Use local version**、**Use remote version**、**Cancel** 三种处理方式。
* **主题切换**：支持跟随 Tabby 主题，也支持手动切换明暗色。
* **Markdown 预览**：Markdown 文件可在 Source / Preview 间切换，预览链路包含 GFM、KaTeX 数学公式渲染和 Mermaid 图表渲染。
* **SVG 预览**：SVG 文件可在 Source / Preview 间切换，预览前会进行清理和安全处理。
* **PDF 预览**：PDF 会进入只读预览模式，支持翻页、页码跳转、缩放。若 PDF 自带 outline，也能在侧边栏查看和跳转。PDF 不是可编辑模式。
* **编码支持**：可重新按指定编码打开，也可按指定编码保存。当前实现提供 `UTF-8`、`GBK`、`GB18030`、`Big5`、`Shift_JIS`、`EUC-KR`、`ISO-8859-1`、`Windows-1252`。BOM 会识别 `UTF-8`、`UTF-16LE`、`UTF-16BE`。
* **保护机制**：文件大于 1 MB 时先警告，大于 5 MB 时只读打开，大于 20 MB 时拒绝打开。检测为二进制内容时默认阻止编辑，但用户可以手动选择 **Force Open**。

## 安装与开发

先安装依赖：

```bash
yarn install
```

常用命令如下：

* `yarn build`，以 development 模式构建
* `yarn build:prod`，以 production 模式构建
* `yarn watch`，监听源码变化并持续重建

Webpack 会把构建结果输出到 `dist/`。包入口是 `dist/index.js`，类型声明是 `dist/index.d.ts`，包内文件列表只包含 `dist/`。

Tabby 会在运行时提供 `@angular/*`、`rxjs`、`tabby-core`、`tabby-ssh` 等依赖；这些依赖在本项目里按 peer/external 方式处理，不会被一起打包进插件。

本仓库当前更适合作为本地开发和打包源。安装到 Tabby 的方式是：先执行构建，再把项目目录复制或软链接到 Tabby 的 Plugins 目录，最后重新加载 Tabby。

## AI 配置与数据发送

插件提供基于选区的 **Translate** 和 **Ask** 功能。选中文本后会出现 AI 入口，Monaco 编辑区的右键菜单里也有对应命令。当前选区入口覆盖三种区域：Monaco 编辑区、Markdown 预览区、PDF 预览中的文本层。

只有在你显式触发时才会发起 AI 请求，例如点击 **Translate**、点击 **Ask** 并提交问题。单纯选中文本不会自动把内容发到外部服务。

请求负载以当前选中文本为基础：

* **Translate** 会把所选文本作为主要输入发送出去
* **Ask** 会把所选文本和你输入的问题一起发送出去

AI 设置由用户手动填写，包括 API Base URL、API Key、翻译模型、Ask 模型、目标语言、Endpoint Mode、超时时间，以及 Ask 使用的 reasoning effort。这里的 API Base URL 需要能配合 `/responses` 或 `/chat/completions` 使用。`Auto` 模式会先尝试 `/responses`，若服务端明显不支持，再回退到 `/chat/completions`。

这些设置会保存在本地 `localStorage`。其中也包括 API Key，所以请按你的本机安全要求自行管理。

## 限制与注意事项

* 不是所有远端文件都可编辑。PDF 仅预览，不可保存；二进制文件默认阻止编辑；超大文件会警告、只读或直接拒绝打开。
* 上传和下载依赖本地文件选择与保存对话框。若当前 Tabby 构建没有这些能力，相关操作会不可用。
* 编码自动识别并不覆盖所有情况。没有 BOM 时，当前自动流程会优先尝试 UTF-8，再尝试 GBK，最后退回 ISO-8859-1。
* 保存 `GBK`、`GB18030`、`Big5`、`Shift_JIS`、`EUC-KR`、`Windows-1252` 等编码时，当前运行环境还需要可用的 `iconv-lite`。
* Markdown 预览里的外部链接可打开，但相对链接目前不支持。
* AI 相关请求有选区长度限制，当前实现上限为 4000 个字符。

## 手动验证清单

* [ ] 执行 `yarn install` 和 `yarn build`，把项目目录复制或软链接到 Tabby 的 Plugins 目录，重新加载 Tabby。
* [ ] 在 SFTP 浏览器里右键普通文件，确认出现 **Edit in Tabby**，并能打开 Monaco 标签页。
* [ ] 修改一个普通文本文件并保存，确认远端内容已更新。
* [ ] 在侧边栏测试展开目录、刷新、返回上级、当前标签打开、新标签打开、复制路径、新建文件、新建文件夹、重命名、删除。
* [ ] 若当前环境支持本地对话框，测试上传到当前目录或目录节点，以及下载当前文件或侧边栏文件。
* [ ] 制造远端并发修改后再保存，确认进入 diff 视图，并验证 **Use local version**、**Use remote version**、**Cancel**。
* [ ] 分别打开 `.md`、`.svg`、`.pdf`，验证 Markdown Source / Preview、KaTeX 数学公式渲染、SVG Source / Preview，以及 PDF 的只读预览、翻页、页码跳转、缩放和 outline 行为。
* [ ] 验证编码切换与按编码保存，再测试二进制文件保护、1 MB 以上警告、5 MB 以上只读、20 MB 以上拒绝打开。
* [ ] 在 Monaco、Markdown 预览或 PDF 文本层中选中文本，先配置 AI，再分别触发 **Translate** 和 **Ask**，确认只有显式触发时才会发送请求，且结果基于所选文本。

## License

MIT

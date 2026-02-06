# Tabby Mingze 在线编辑器

`tabby-mingze-online-editor` 是一个 Tabby 插件。它会在 SSH/SFTP 文件浏览器中增加 **“Edit in Tabby”** 右键菜单，让你直接在 Tabby 内用 Monaco 编辑远端文件，无需手动下载/上传。

## 功能特性

- 在 SFTP 文件列表里右键文件，选择 **Edit in Tabby**，以新标签页打开
- Monaco 编辑器体验（含常见语言语法高亮）
- 左侧目录树：快速切换同目录文件、展开子目录、刷新、返回上级
- 保存时进行远端变更检测；发生冲突时进入 Diff 视图并提供冲突处理按钮
- 支持多种文本编码：UTF-8、GBK、GB18030、Big5、Shift_JIS、EUC-KR、ISO-8859-1、Windows-1252
- 自动识别 BOM（如 UTF-8 / UTF-16）
- 大文件保护策略：
  - 大于 1 MB：打开前警告
  - 大于 5 MB：以只读方式打开
  - 大于 20 MB：拒绝打开
- 二进制文件检测（默认阻止编辑，可手动强制打开）
- 支持跟随 Tabby 主题或手动切换明/暗色主题

## 安装与使用

> 当前仓库主要用于本地开发与打包。

1. 安装依赖并构建：

```bash
yarn install
yarn build
```

2. 将本项目目录复制或软链接到 Tabby 的 Plugins 目录。
3. 重启（或重新加载）Tabby。
4. 打开 SFTP 面板，右键某个文件，点击 **Edit in Tabby**。

## 开发命令

```bash
yarn install
yarn build
yarn watch
```

- `yarn build`：输出插件到 `dist/`
- `yarn watch`：监听源码变更并自动重建

## 项目结构

```text
src/
  index.ts                        # Angular 模块入口，设置 Monaco public path
  remoteEditorTab.component.ts    # 远端编辑 Tab 主逻辑
  remoteEditorTab.component.pug   # 编辑器界面模板
  sftpContextMenu.ts              # SFTP 右键菜单扩展（Edit in Tabby）
  shims-tabby.d.ts                # Tabby API 类型补充
dist/                             # 构建产物
```

## 注意事项

- Tabby 运行时会提供 `tabby-core`、`tabby-ssh`、Angular、RxJS 等依赖，这些在本项目中以 `peerDependencies` 声明。
- 若需要保存非 UTF-8 编码文件，运行环境中可能需要可用的 `iconv-lite`。
- 暂无自动化测试，建议在改动后执行手动验证（打开、编辑、保存、冲突处理、大小文件与编码场景）。

## 手动验证清单（建议）

- 打开 SFTP 浏览器 → 右键文件 → **Edit in Tabby**
- 修改并保存文件，确认远端内容已更新
- 两端同时修改同一文件，确认冲突检测与 Diff 处理正常
- 验证大文件与二进制文件行为符合预期
- （如涉及编码）切换编码后重新加载与保存，确认无乱码

## License

MIT

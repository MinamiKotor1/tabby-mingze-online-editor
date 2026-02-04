# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tabby plugin that adds "Edit in Tabby" to SSH/SFTP file browser. Uses Monaco editor to edit remote files directly over SFTP.

## Build Commands

```bash
yarn install      # Install dependencies
yarn build        # Build plugin to dist/
yarn watch        # Build with file watching for development
```

## Architecture

**Angular Module Plugin** - Tabby loads plugins via `require()` at runtime, providing Angular, RxJS, and Tabby packages.

```
src/
├── index.ts                      # Module entry, sets __webpack_public_path__ for Worker loading
├── remoteEditorTab.component.ts  # Monaco editor tab component
├── remoteEditorTab.component.pug # Pug template
├── sftpContextMenu.ts            # SFTP right-click menu provider
└── shims-tabby.d.ts              # Type shims for Tabby APIs (decouples from full Tabby install)
```

**Key Patterns**:
- `__webpack_public_path__` must be set before Monaco import (Workers need correct paths)
- File writes use atomic temp-file pattern: write `.tabby-online-edit` → rename → chmod
- `settingValue` flag prevents dirty state when programmatically setting editor content
- Webpack `externals` exclude Angular/RxJS/Tabby packages (provided at runtime)

**Component State** (`remoteEditorTab.component.ts`):
- `sshSession` / `path` - Remote file location
- `dirty` / `saving` / `loading` - UI state flags
- Language detection via file extension mapping

## Development

1. `yarn watch` for auto-rebuild
2. Copy/link `dist/` to Tabby's Plugins folder
3. Reload Tabby to test changes

Peer dependencies (`@angular/*`, `rxjs`, `tabby-core`, `tabby-ssh`) are provided by Tabby runtime.

## Current Limitations

- Assumes UTF-8 text files
- No binary/large file handling

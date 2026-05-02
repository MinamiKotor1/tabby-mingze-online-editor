# Node 22 Build Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the plugin's install and build workflow explicit and reliable for Node.js 22.22.2, with Windows guidance.

**Architecture:** Keep the existing Yarn Classic + Webpack 5 + TypeScript pipeline. Make only metadata and documentation changes unless verification exposes an actual Node 22 build failure.

**Tech Stack:** Node.js 22.22.2 target, Yarn 1.x, Webpack 5, TypeScript 5, ts-loader, Monaco editor webpack plugin.

---

## File Structure

- `package.json`: declare supported Node and Yarn versions using `engines` and `packageManager`.
- `README.md`: document Windows installation with Node 22.22.2, Yarn Classic, build commands, and Tabby plugin directory.
- `yarn.lock`: unchanged unless a verification failure requires a targeted dependency update.
- `src/`: unchanged for this compatibility pass.

### Task 1: Declare Runtime Tooling Support

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add package manager and engines metadata**

Edit `package.json` so the root object includes these fields after `license`:

```json
  "license": "MIT",
  "packageManager": "yarn@1.22.22",
  "engines": {
    "node": ">=18.12 <23",
    "yarn": ">=1.22 <2"
  },
```

This keeps the current Node 20 workflow valid while allowing Node 22.22.2 and preventing accidental use of Yarn Berry.

- [ ] **Step 2: Check JSON validity**

Run:

```bash
node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8')); console.log('package.json ok')"
```

Expected output:

```text
package.json ok
```

### Task 2: Update Windows Installation Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the short install section with Node 22 Windows guidance**

Replace the content under `## 安装` through the paragraph that currently ends with `最后重启或重新加载 Tabby。` with:

```markdown
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
```

- [ ] **Step 2: Verify install section renders coherently**

Run:

```bash
rg -n "^## 安装|^### Windows|^### Linux|Node.js `22.22.2`|%APPDATA%" README.md
```

Expected output includes all five matched topics.

### Task 3: Verify Build Compatibility

**Files:**
- Read: `package.json`
- Read: `webpack.config.js`
- Read: `tsconfig.json`
- Generated: `dist/`

- [ ] **Step 1: Record local tool versions**

Run:

```bash
node -v
yarn -v
```

Expected:

```text
v22.22.2
1.22.x
```

If the local machine is not running Node 22.22.2, record the actual version in the final report and do not claim local Node 22 verification.

- [ ] **Step 2: Install dependencies**

Run:

```bash
yarn install
```

Expected: command exits 0. If it fails because Node 22 rejects an existing dependency, update only the failing build dependency and re-run this step.

- [ ] **Step 3: Run development build**

Run:

```bash
yarn build
```

Expected: command exits 0 and writes `dist/index.js`.

- [ ] **Step 4: Run production build**

Run:

```bash
yarn build:prod
```

Expected: command exits 0 and writes optimized `dist/index.js`.

- [ ] **Step 5: Review final git diff**

Run:

```bash
git diff -- package.json README.md yarn.lock
```

Expected: diff contains only Node/Yarn metadata, install docs, and any targeted lockfile changes required by verification.

### Task 4: Commit Compatibility Changes

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `yarn.lock` only if dependency verification required it

- [ ] **Step 1: Check working tree**

Run:

```bash
git status --short
```

Expected: only planned files are modified, plus already committed design and plan history.

- [ ] **Step 2: Commit changes**

Run:

```bash
git add package.json README.md yarn.lock
git commit -m "build: support node 22"
```

If `yarn.lock` is unchanged, omit it from `git add`.

## Self-Review

- Spec coverage: the plan covers Node version declaration, Yarn Classic retention, Windows installation docs, conservative dependency updates, and build verification.
- Placeholder scan: no placeholder steps remain.
- Scope check: no source refactor, Webpack replacement, package manager migration, or marketplace publishing is included.

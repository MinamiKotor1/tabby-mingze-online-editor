# Node 22 Build Compatibility Design

## Goal

Make this Tabby plugin install and build reliably with Node.js 22.22.2, especially on Windows. The target validation commands are:

```bash
yarn install
yarn build
yarn build:prod
```

## Scope

This is a minimal build compatibility pass. It does not change editor behavior, SFTP behavior, preview behavior, AI behavior, or the large component structure.

In scope:

- Declare the supported Node.js range for this project.
- Keep Yarn Classic as the default package manager.
- Check dependency and build-script compatibility with Node.js 22.22.2.
- Update only the dependencies or configuration needed for Node 22 build stability.
- Document the Windows installation path and Node/Yarn setup clearly.

Out of scope:

- Splitting `remoteEditorTab.component.ts`.
- Replacing Webpack.
- Migrating to Yarn Berry, pnpm, npm workspaces, or another package manager.
- Changing Tabby runtime integration.
- Publishing to a plugin marketplace.

## Approach

Use the conservative path first: keep the existing Webpack 5, TypeScript, ts-loader, Monaco plugin, and Yarn 1 workflow unless Node 22 exposes a concrete install or build failure.

If a failure appears, prefer the smallest targeted dependency update that fixes it. Avoid broad dependency upgrades because this plugin depends on Tabby/Electron runtime behavior and Webpack externals.

## Expected Changes

- `package.json` may gain an `engines.node` entry that keeps Node 18.12+ valid while explicitly allowing Node 22, for example `>=18.12 <23`.
- `README.md` should include Windows guidance for Node 22.22.2, Yarn Classic, build commands, and the Tabby plugin directory.
- `yarn.lock` changes only if dependency updates are required.
- Source files under `src/` should remain unchanged unless a build failure proves a TypeScript compatibility issue.

## Verification

Run these checks after changes:

```bash
yarn install
yarn build
yarn build:prod
```

If the local machine cannot switch to Node.js 22.22.2, document that limitation and verify as much as possible with the current Node version.

## Risks

The main risk is over-upgrading the build chain and creating a package that builds but no longer loads correctly inside Tabby. The mitigation is to keep the build chain stable and only change what Node 22 requires.

Another risk is claiming Windows support without testing on Windows. The mitigation is to write Windows-specific installation instructions separately from verified local build results.

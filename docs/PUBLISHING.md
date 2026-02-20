# Publishing Guide

Step-by-step instructions for packaging and publishing the LaTeX Citation Assistant extension.

---

## Prerequisites

- **Node.js** 20 or later
- **npm** (included with Node.js)
- **vsce** (VS Code Extension CLI) -- installed as a dev dependency or globally
- A [Visual Studio Marketplace](https://marketplace.visualstudio.com/) publisher account (for VS Code Marketplace)
- A [Personal Access Token](https://dev.azure.com/) from Azure DevOps (for VS Code Marketplace publishing)
- An [Open VSX](https://open-vsx.org/) account (for Windsurf, VSCodium, and other VS Code forks)

---

## Building

Install dependencies and compile TypeScript to JavaScript:

```bash
npm install
npm run compile
```

This runs `tsc -p ./` which compiles all TypeScript files in `src/` to JavaScript in `out/`. The `vscode:prepublish` script also runs `npm run compile`, so packaging will always compile first.

To watch for changes during development:

```bash
npm run watch
```

To lint the source:

```bash
npm run lint
```

---

## Packaging

Create a `.vsix` package file:

```bash
npx @vscode/vsce package
```

This produces a file named `latex-citation-assistant-{version}.vsix` in the project root. The version is read from `package.json`.

**Common issues:**

- If you see warnings about missing `repository` or `LICENSE`, ensure both are present and correctly referenced in `package.json`.
- The `icon` field in `package.json` must point to an existing image file (`resources/icon.png`). The icon should be at least 128x128 pixels.
- Ensure the `README.md` is present in the project root -- it becomes the Marketplace listing page.

---

## Testing Locally

Install the packaged extension in your local VS Code:

```bash
code --install-extension latex-citation-assistant-*.vsix
```

Then reload VS Code (`Ctrl+Shift+P` -> "Developer: Reload Window") and open a `.tex` file to verify the extension activates.

To uninstall:

```bash
code --uninstall-extension renato-duarte.latex-citation-assistant
```

---

## Publishing to VS Code Marketplace

### One-Time Setup

1. **Create a publisher account.**

   Go to [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) and sign in with a Microsoft account. Create a publisher with the ID `renato-duarte` (must match the `publisher` field in `package.json`).

2. **Create a Personal Access Token (PAT).**

   Go to [dev.azure.com](https://dev.azure.com/) and sign in with the same Microsoft account. Navigate to User Settings (top-right icon) -> Personal Access Tokens -> New Token.

   Configure the token:
   - **Name**: `vsce-publish` (or any descriptive name)
   - **Organization**: Select "All accessible organizations"
   - **Scopes**: Select "Custom defined", then find and check **Marketplace > Manage**
   - **Expiration**: Choose an appropriate duration (you will need to regenerate when it expires)

   Copy the token immediately -- it is only shown once.

3. **Log in with vsce.**

   ```bash
   npx @vscode/vsce login renato-duarte
   ```

   Paste the PAT when prompted. This stores the token locally for future publishes.

### Publishing

```bash
npx @vscode/vsce publish
```

This compiles, packages, and uploads the extension in one step. The version from `package.json` is used.

To publish with a version bump:

```bash
npx @vscode/vsce publish minor   # 1.0.0 -> 1.1.0
npx @vscode/vsce publish patch   # 1.0.0 -> 1.0.1
npx @vscode/vsce publish major   # 1.0.0 -> 2.0.0
```

The version bump is written back to `package.json` automatically.

After publishing, the extension typically appears on the Marketplace within 5-10 minutes.

---

## Publishing to Open VSX

Open VSX is the open extension registry used by Windsurf, VSCodium, Gitpod, Eclipse Theia, and other VS Code-compatible editors.

### One-Time Setup

1. Go to [open-vsx.org](https://open-vsx.org/) and sign in with a GitHub account.
2. Navigate to your profile settings and generate an access token.
3. Copy the token.

### Publishing

First, package the extension if you have not already:

```bash
npx @vscode/vsce package
```

Then publish to Open VSX:

```bash
npx ovsx publish latex-citation-assistant-*.vsix -p <your-openvsx-token>
```

Install the `ovsx` CLI globally if needed:

```bash
npm install -g ovsx
```

---

## Versioning Strategy

This project follows [Semantic Versioning](https://semver.org/) (SemVer):

- **MAJOR** (e.g., 1.0.0 -> 2.0.0): Breaking changes to user-facing behavior, settings schema changes that require migration, or removal of features.
- **MINOR** (e.g., 1.0.0 -> 1.1.0): New features, new settings, new commands, or significant improvements to existing functionality. Backward-compatible.
- **PATCH** (e.g., 1.0.0 -> 1.0.1): Bug fixes, performance improvements, documentation updates, dependency bumps. No new features.

Examples:
- Adding a new citation source (e.g., PubMed) -> minor
- Fixing a crash when the Zotero API returns malformed data -> patch
- Changing the settings namespace from `latexCite` to something else -> major

---

## Pre-Publish Checklist

Before every release:

- [ ] **Version**: Update `version` in `package.json` (or use `vsce publish {major|minor|patch}`)
- [ ] **Changelog**: Document changes since the last release
- [ ] **README**: Ensure the README is up to date with any new features or settings
- [ ] **Icon**: Verify `resources/icon.png` exists and is at least 128x128 pixels
- [ ] **Compile**: Run `npm run compile` and verify no TypeScript errors
- [ ] **Lint**: Run `npm run lint` and fix any issues
- [ ] **Test locally**: Install the `.vsix` in VS Code and test all four commands
- [ ] **Test Zotero search**: Verify results return correctly with valid credentials
- [ ] **Test Semantic Scholar search**: Verify results and BibTeX file writing
- [ ] **Test context analysis**: Run "Analyze Document Context" on a real LaTeX file
- [ ] **Test edge cases**: Empty document, document with no sections, no internet connection
- [ ] **Dependencies**: Run `npm audit` and address any vulnerabilities
- [ ] **Package size**: Run `npx @vscode/vsce ls` to review included files; ensure no unnecessary files are bundled

---

## CI/CD Considerations

For automated publishing, store your tokens as secrets in your CI environment:

```yaml
# Example GitHub Actions snippet
- name: Publish to VS Code Marketplace
  run: npx @vscode/vsce publish -p ${{ secrets.VSCE_PAT }}

- name: Publish to Open VSX
  run: npx ovsx publish *.vsix -p ${{ secrets.OVSX_TOKEN }}
```

A `.vscodeignore` file (if present) controls which files are excluded from the `.vsix` package. Common exclusions:

```
.vscode/
.vscode-test/
src/
node_modules/
docs/
*.ts
tsconfig.json
.eslintrc*
```

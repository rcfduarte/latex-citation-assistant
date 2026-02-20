# Chrome Extension for Overleaf — Design Document

Status: **Planned** (not yet implemented)

## Overview

A Chrome extension that brings the LaTeX Citation Assistant pipeline to Overleaf.
Entirely client-side — no Overleaf account or API access needed.

## Feasibility

- Overleaf uses CodeMirror 6 (CM6)
- CM6 `EditorView` accessible via `UNSTABLE_editor:extensions` event (semi-official hook, stable for 2+ years, used by Overleaf-Copilot and others)
- Chrome Side Panel API provides persistent citation results UI
- S2 and Zotero APIs callable from service worker via `fetch`

## Architecture

```
Overleaf tab
  content-main.js (world: MAIN)
    - Hooks into UNSTABLE_editor:extensions to get EditorView
    - Reads cursor position + surrounding LaTeX context
    - Posts context via window.postMessage
        |
  content-isolated.js (world: ISOLATED)
    - Bridges window.postMessage to chrome.runtime
        |
background.js (service worker)
    - LLM query generation (Claude Haiku via fetch)
    - S2 search + recommendations (fetch)
    - Zotero search (fetch)
    - Heuristic ranking + LLM re-ranking
    - Sends results to side panel
        |
sidepanel.html
    - Citation cards UI (adapted from webview.ts design)
    - Multi-select + insert
    - Insert command flows back: panel -> SW -> isolated -> main -> view.dispatch()
```

## Key Technical Points

- **Two content scripts needed**: `world: MAIN` can access CM6 internals but has no `chrome.*` APIs; `world: ISOLATED` bridges to the extension runtime
- **Service worker**: Must use `fetch()` (no axios). Search pipeline logic reusable with axios-to-fetch conversion
- **Citation insertion**: `view.dispatch({ changes: { from: cursorPos, insert: "\\cite{key}" } })`
- **BibTeX**: Copy to clipboard or find/append to `.bib` file tab
- **Trigger**: `Ctrl+Shift+Z` via `chrome.commands` or injected toolbar button

## Risks

| Risk | Probability | Mitigation |
|------|-------------|------------|
| `UNSTABLE_editor:extensions` removed | Low | Widely used by extensions; Overleaf unlikely to break ecosystem |
| MV3 service worker 5-min idle timeout | Medium | Use `chrome.alarms` or keepalive during long LLM calls |
| Page CSP blocking service worker fetch | Non-issue | Service worker operates outside page CSP |

## Shared Code Strategy

Start with copy-paste adaptation (ship quickly). Refactor to monorepo with shared `core/` package later if both versions are actively maintained.

## Estimated Effort

2–3 implementation sessions.

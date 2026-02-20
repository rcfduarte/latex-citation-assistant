/**
 * HTML/CSS/JS generator for the Citation Suggestions webview panel.
 *
 * Produces a compact, scrollable panel with paper cards, inline SVG
 * icons, VS Code theme-aware styling, and multi-select support.
 * Uses event delegation for reliable button handling.
 *
 * @module ui/webview
 */

import { CitationResult } from '../types';

/**
 * Generate the full HTML content for the citation panel webview.
 */
export function generateWebviewHtml(
    results: CitationResult[],
    durationMs: number,
    nonce: string,
): string {
    const resultsJson = JSON.stringify(results);

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <title>Citation Suggestions</title>
    <style nonce="${nonce}">
        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: var(--vscode-font-family, system-ui, sans-serif);
            font-size: 12px;
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background, var(--vscode-editor-background));
            padding: 0;
            line-height: 1.5;
            overflow-y: auto;
            height: 100vh;
        }

        /* ── Header ─────────────────────────────────────── */
        .header {
            position: sticky;
            top: 0;
            z-index: 10;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            background: var(--vscode-sideBarSectionHeader-background, var(--vscode-editor-background));
            border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-widget-border, rgba(127,127,127,.2)));
        }

        .header-left {
            display: flex;
            align-items: center;
            gap: 6px;
            font-weight: 600;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: .5px;
            color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
        }

        .header-left svg { width: 14px; height: 14px; fill: currentColor; }

        .header-right {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        /* ── Card list ──────────────────────────────────── */
        .cards {
            padding: 4px 8px;
            padding-bottom: 8px;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        /* Extra bottom padding when selection bar is visible */
        body.has-selection .cards { padding-bottom: 52px; }

        /* ── Card ───────────────────────────────────────── */
        .card {
            display: flex;
            border: 1px solid var(--vscode-widget-border, rgba(127,127,127,.15));
            border-radius: 6px;
            overflow: hidden;
            background: var(--vscode-editor-background);
            transition: border-color .15s, box-shadow .15s;
        }
        .card:hover {
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 1px 4px rgba(0,0,0,.1);
        }
        .card.selected {
            border-color: var(--vscode-focusBorder);
            background: var(--vscode-list-activeSelectionBackground, rgba(59,130,246,.08));
        }

        /* Relevance bar */
        .rbar { width: 4px; flex-shrink: 0; }
        .rbar-h { background: #34d399; }
        .rbar-m { background: #fbbf24; }
        .rbar-l { background: #f87171; }

        /* Checkbox column */
        .ccheck {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0 2px 0 8px;
            flex-shrink: 0;
            cursor: pointer;
        }

        .ccheck input[type="checkbox"] {
            width: 14px;
            height: 14px;
            cursor: pointer;
            accent-color: var(--vscode-button-background, #007acc);
        }

        /* Card body */
        .cbody {
            flex: 1; min-width: 0;
            padding: 8px 10px 8px 6px;
        }

        /* Title row */
        .ctitle {
            font-size: 12px;
            font-weight: 600;
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
            line-height: 1.35;
            display: block;
            cursor: pointer;
        }
        .ctitle:hover { text-decoration: underline; }

        /* Meta line */
        .cmeta {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
            display: flex;
            align-items: center;
            gap: 4px;
            flex-wrap: wrap;
        }
        .cmeta svg { width: 10px; height: 10px; fill: currentColor; opacity: .6; flex-shrink: 0; }
        .cmeta .sep { opacity: .3; }

        /* Badges row */
        .cbadges { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }

        .badge {
            display: inline-flex; align-items: center; gap: 3px;
            font-size: 10px; font-weight: 500;
            padding: 1px 6px; border-radius: 10px;
            line-height: 1.5;
        }
        .badge svg { width: 9px; height: 9px; fill: currentColor; }

        .b-cite { background: rgba(59,130,246,.1); color: #60a5fa; }
        .b-infl { background: rgba(168,85,247,.1); color: #c084fc; }
        .b-zot  { background: rgba(204,51,51,.1); color: #f87171; }
        .b-s2   { background: rgba(59,130,246,.1); color: #60a5fa; }
        .b-reason {
            background: var(--vscode-textBlockQuote-background, rgba(127,127,127,.06));
            color: var(--vscode-descriptionForeground);
            font-style: italic; font-weight: 400;
            max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }

        /* Summary */
        .csum {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
            line-height: 1.5;
            overflow: hidden;
        }
        .csum.clamp {
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
        }

        .ctoggle {
            font-size: 10px; color: var(--vscode-textLink-foreground);
            cursor: pointer; background: none; border: none;
            padding: 0; margin-top: 2px; font-family: inherit;
            display: inline-flex; align-items: center; gap: 2px;
        }
        .ctoggle:hover { text-decoration: underline; }
        .ctoggle svg { width: 8px; height: 8px; fill: currentColor; transition: transform .15s; }
        .ctoggle.open svg { transform: rotate(180deg); }

        /* Right actions column */
        .cactions {
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            padding: 6px 8px; gap: 6px; flex-shrink: 0;
        }

        /* Score badge */
        .cscore {
            font-size: 10px; font-weight: 700;
            padding: 2px 6px; border-radius: 10px;
            min-width: 32px; text-align: center;
        }
        .cscore-h { background: rgba(52,211,153,.15); color: #34d399; }
        .cscore-m { background: rgba(251,191,36,.15); color: #f59e0b; }
        .cscore-l { background: rgba(248,113,113,.15); color: #f87171; }

        /* Insert button */
        .cinsert {
            display: inline-flex; align-items: center; gap: 3px;
            font-size: 11px; font-weight: 500;
            padding: 3px 8px; border: none; border-radius: 4px;
            cursor: pointer; white-space: nowrap; font-family: inherit;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            transition: background .12s;
        }
        .cinsert:hover { background: var(--vscode-button-hoverBackground); }
        .cinsert svg { width: 10px; height: 10px; fill: currentColor; }

        /* Open link */
        .copen {
            font-size: 10px; color: var(--vscode-descriptionForeground);
            cursor: pointer; background: none; border: none; padding: 0;
            font-family: inherit; display: inline-flex; align-items: center; gap: 2px;
            opacity: .6; transition: opacity .12s, color .12s;
        }
        .copen:hover { opacity: 1; color: var(--vscode-textLink-foreground); }
        .copen svg { width: 9px; height: 9px; fill: currentColor; }

        .empty {
            text-align: center; padding: 40px 12px;
            color: var(--vscode-descriptionForeground);
        }

        /* ── Selection bar (sticky footer) ──────────────── */
        .selbar {
            position: fixed;
            bottom: 0; left: 0; right: 0;
            z-index: 20;
            display: none;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
            border-top: 1px solid var(--vscode-widget-border, rgba(127,127,127,.2));
            box-shadow: 0 -2px 8px rgba(0,0,0,.15);
        }

        body.has-selection .selbar { display: flex; }

        .selbar-left {
            font-size: 12px;
            font-weight: 500;
            color: var(--vscode-foreground);
        }

        .selbar-actions {
            display: flex;
            gap: 8px;
            align-items: center;
        }

        .sel-insert {
            display: inline-flex; align-items: center; gap: 4px;
            font-size: 12px; font-weight: 600;
            padding: 5px 14px; border: none; border-radius: 4px;
            cursor: pointer; white-space: nowrap; font-family: inherit;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            transition: background .12s;
        }
        .sel-insert:hover { background: var(--vscode-button-hoverBackground); }
        .sel-insert svg { width: 12px; height: 12px; fill: currentColor; }

        .sel-clear {
            font-size: 11px; color: var(--vscode-descriptionForeground);
            cursor: pointer; background: none; border: none; padding: 2px 6px;
            font-family: inherit; border-radius: 3px;
            transition: color .12s, background .12s;
        }
        .sel-clear:hover {
            color: var(--vscode-foreground);
            background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.1));
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-left">
            <svg viewBox="0 0 16 16"><path d="M4.5 2A2.5 2.5 0 002 4.5v7A2.5 2.5 0 004.5 14h7a2.5 2.5 0 002.5-2.5v-7A2.5 2.5 0 0011.5 2h-7zM5 5h6v1H5V5zm0 2.5h6v1H5v-1zM5 10h4v1H5v-1z"/></svg>
            ${results.length} citations
        </div>
        <div class="header-right">${(durationMs / 1000).toFixed(1)}s</div>
    </div>
    <div class="cards" id="cards"></div>
    <div class="selbar" id="selbar">
        <span class="selbar-left" id="selcount">0 selected</span>
        <div class="selbar-actions">
            <button class="sel-clear" id="selclear">Clear</button>
            <button class="sel-insert" id="selinsert">
                <svg viewBox="0 0 16 16"><path d="M14 7v1H8v6H7V8H1V7h6V1h1v6z"/></svg>
                Insert selected
            </button>
        </div>
    </div>

    <script nonce="${nonce}">
    (function(){
        const vscode = acquireVsCodeApi();
        const R = ${resultsJson};
        const selected = new Set();

        const I = {
            person: '<svg viewBox="0 0 16 16"><path d="M8 2a2.5 2.5 0 110 5 2.5 2.5 0 010-5zM4 10a2 2 0 012-2h4a2 2 0 012 2v1.5a.5.5 0 01-.5.5h-7a.5.5 0 01-.5-.5V10z"/></svg>',
            cal: '<svg viewBox="0 0 16 16"><path d="M5 1v1H3.5A1.5 1.5 0 002 3.5v9A1.5 1.5 0 003.5 14h9a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0012.5 2H11V1h-1v1H6V1H5zm-2 4h10v7.5a.5.5 0 01-.5.5h-9a.5.5 0 01-.5-.5V5z"/></svg>',
            book: '<svg viewBox="0 0 16 16"><path d="M3 1.5A1.5 1.5 0 014.5 0h7A1.5 1.5 0 0113 1.5v13a.5.5 0 01-.5.5h-9a.5.5 0 01-.5-.5v-13zM4.5 1a.5.5 0 00-.5.5V14h8V1.5a.5.5 0 00-.5-.5h-7z"/></svg>',
            cite: '<svg viewBox="0 0 16 16"><path d="M7 5H4a1 1 0 00-1 1v3a1 1 0 001 1h1.5L4 13h2l1.5-3H7a1 1 0 001-1V6a1 1 0 00-1-1zm5 0H9a1 1 0 00-1 1v3a1 1 0 001 1h1.5L9 13h2l1.5-3H12a1 1 0 001-1V6a1 1 0 00-1-1z"/></svg>',
            star: '<svg viewBox="0 0 16 16"><path d="M8 1.3l2 4 4.5.7-3.2 3.2.8 4.5L8 11.5l-4 2.2.8-4.5L1.5 6l4.5-.7z"/></svg>',
            plus: '<svg viewBox="0 0 16 16"><path d="M14 7v1H8v6H7V8H1V7h6V1h1v6z"/></svg>',
            link: '<svg viewBox="0 0 16 16"><path d="M7.775 3.275a.75.75 0 001.06 1.06l1.25-1.25a2 2 0 112.83 2.83l-2.5 2.5a2 2 0 01-2.83 0 .75.75 0 00-1.06 1.06 3.5 3.5 0 004.95 0l2.5-2.5a3.5 3.5 0 00-4.95-4.95l-1.25 1.25zm-.55 9.45a.75.75 0 01-1.06-1.06l-1.25 1.25a2 2 0 11-2.83-2.83l2.5-2.5a2 2 0 012.83 0 .75.75 0 001.06-1.06 3.5 3.5 0 00-4.95 0l-2.5 2.5a3.5 3.5 0 004.95 4.95l1.25-1.25z"/></svg>',
            chev: '<svg viewBox="0 0 16 16"><path d="M8 10.5l-4-4 .7-.7L8 9.1l3.3-3.3.7.7z"/></svg>',
            zot: '<svg viewBox="0 0 16 16"><path d="M3 2h10v1.5L6.5 12H13v2H3v-1.5L9.5 4H3z"/></svg>',
        };

        function esc(t) {
            const d = document.createElement('div'); d.textContent = t; return d.innerHTML;
        }

        function authors(a) {
            if (!a || !a.length) return '';
            const f = a[0].lastName || a[0].name || '?';
            if (a.length === 1) return esc(f);
            if (a.length === 2) return esc(f + ' & ' + (a[1].lastName || a[1].name || ''));
            return esc(f + ' et al.');
        }

        function rclass(s) { return s >= 70 ? 'h' : s >= 40 ? 'm' : 'l'; }

        function card(r, i) {
            const rc = rclass(r.relevanceScore);
            const isZ = r.source === 'zotero';
            const sum = r.tldr || r.abstract || '';
            const au = authors(r.authors);

            let meta = '';
            if (au) meta += '<span>' + I.person + ' ' + au + '</span>';
            if (r.year) { if (meta) meta += '<span class="sep">&middot;</span>'; meta += '<span>' + I.cal + ' ' + r.year + '</span>'; }
            if (r.journal) { if (meta) meta += '<span class="sep">&middot;</span>'; meta += '<span>' + I.book + ' ' + esc(r.journal) + '</span>'; }

            let badges = '';
            if (r.citationCount != null) badges += '<span class="badge b-cite">' + I.cite + ' ' + r.citationCount.toLocaleString() + '</span>';
            if (r.influentialCitationCount > 0) badges += '<span class="badge b-infl">' + I.star + ' ' + r.influentialCitationCount + '</span>';
            badges += isZ ? '<span class="badge b-zot">' + I.zot + ' Zotero</span>' : '<span class="badge b-s2">' + I.cite + ' S2</span>';
            if (r.relevanceReason) badges += '<span class="badge b-reason">' + esc(r.relevanceReason) + '</span>';

            let sumHtml = '';
            if (sum) {
                sumHtml = '<div class="csum clamp" data-sum="' + i + '">' + esc(sum) + '</div>'
                    + '<button class="ctoggle" data-toggle="' + i + '">' + I.chev + ' more</button>';
            }

            return '<div class="card" data-card="' + i + '">'
                + '<div class="rbar rbar-' + rc + '"></div>'
                + '<div class="ccheck"><input type="checkbox" data-check="' + i + '"></div>'
                + '<div class="cbody">'
                + (r.url
                    ? '<a class="ctitle" data-open="' + esc(r.url) + '">' + esc(r.title) + '</a>'
                    : '<span class="ctitle">' + esc(r.title) + '</span>')
                + '<div class="cmeta">' + meta + '</div>'
                + '<div class="cbadges">' + badges + '</div>'
                + sumHtml
                + '</div>'
                + '<div class="cactions">'
                + '<span class="cscore cscore-' + rc + '">' + r.relevanceScore + '</span>'
                + '<button class="cinsert" data-insert="' + i + '">' + I.plus + ' Insert</button>'
                + (r.url ? '<button class="copen" data-open="' + esc(r.url) + '">' + I.link + ' Open</button>' : '')
                + '</div>'
                + '</div>';
        }

        function updateSelectionUI() {
            const n = selected.size;
            document.body.classList.toggle('has-selection', n > 0);
            document.getElementById('selcount').textContent = n + ' selected';

            // Sync card highlight states
            document.querySelectorAll('.card').forEach(function(c) {
                const idx = parseInt(c.dataset.card);
                c.classList.toggle('selected', selected.has(idx));
            });
        }

        function toggleSelect(idx) {
            if (selected.has(idx)) {
                selected.delete(idx);
            } else {
                selected.add(idx);
            }

            // Sync checkbox
            const cb = document.querySelector('[data-check="' + idx + '"]');
            if (cb) cb.checked = selected.has(idx);

            updateSelectionUI();
        }

        // Render
        const el = document.getElementById('cards');
        el.innerHTML = R.length ? R.map(card).join('') : '<div class="empty">No results.</div>';

        // Event delegation on the card container
        el.addEventListener('click', function(e) {
            const t = e.target;

            // Checkbox clicks
            const cb = t.closest ? t.closest('[data-check]') : null;
            if (cb) {
                const idx = parseInt(cb.dataset.check);
                // The checkbox already toggled its own checked state,
                // so sync our Set to match
                if (cb.checked) { selected.add(idx); } else { selected.delete(idx); }
                updateSelectionUI();
                return;
            }

            const btn = t.closest ? t.closest('[data-insert], [data-open], [data-toggle]') : null;
            if (!btn) return;

            e.preventDefault();
            e.stopPropagation();

            if (btn.dataset.insert !== undefined) {
                vscode.postMessage({ type: 'insertCitation', index: parseInt(btn.dataset.insert) });
            } else if (btn.dataset.open !== undefined) {
                vscode.postMessage({ type: 'openUrl', url: btn.dataset.open });
            } else if (btn.dataset.toggle !== undefined) {
                const idx = btn.dataset.toggle;
                const sum = el.querySelector('[data-sum="' + idx + '"]');
                if (sum) {
                    const collapsed = sum.classList.toggle('clamp');
                    btn.innerHTML = collapsed ? I.chev + ' more' : I.chev + ' less';
                    btn.classList.toggle('open', !collapsed);
                }
            }
        });

        // Selection bar buttons
        document.getElementById('selinsert').addEventListener('click', function() {
            if (selected.size === 0) return;
            var indices = Array.from(selected).sort(function(a, b) { return a - b; });
            vscode.postMessage({ type: 'insertMultiple', indices: indices });
        });

        document.getElementById('selclear').addEventListener('click', function() {
            selected.clear();
            document.querySelectorAll('[data-check]').forEach(function(cb) { cb.checked = false; });
            updateSelectionUI();
        });
    })();
    </script>
</body>
</html>`;
}

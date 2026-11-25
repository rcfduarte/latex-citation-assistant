/**
 * Main entry point for the LaTeX Citation Assistant VS Code extension.
 *
 * Initialises all subsystems (logging, configuration, source clients,
 * search engine, UI components) and registers the four user-facing
 * commands:
 *
 * | Command                         | Keybinding   | Description                        |
 * |---------------------------------|--------------|------------------------------------|
 * | `latex-cite.suggest`            | Ctrl+Shift+Z | Context-aware citation suggestions |
 * | `latex-cite.suggestZotero`      |              | Search Zotero by manual term       |
 * | `latex-cite.suggestSemanticScholar` | Ctrl+Shift+S | Search Semantic Scholar by term  |
 * | `latex-cite.analyzeContext`     |              | Display context analysis           |
 *
 * @module extension
 */

import * as vscode from 'vscode';

import { CitationSource, DocumentContext } from './types';
import { getConfig } from './utils/config';
import { getLogger } from './utils/logger';
import { ContextExtractor } from './context/extractor';
import { ZoteroSource } from './sources/zotero';
import { SemanticScholarSource } from './sources/semantic-scholar';
import { ResultRanker } from './search/ranker';
import { SearchEngine } from './search/engine';
import { BibtexWriter } from './bibtex/writer';
import { StatusBarManager } from './ui/status-bar';
import { CitationPicker } from './ui/quick-pick';
import { CitationPanel } from './ui/citation-panel';
import { createLLMProvider } from './llm';

/**
 * Activate the extension.
 *
 * Called by VS Code when the activation event fires (opening a `.tex`
 * or `.latex` file). Sets up all components and registers commands and
 * disposables.
 *
 * @param context - The extension context provided by VS Code.
 */
export function activate(context: vscode.ExtensionContext): void {
    // ── 1. Logger ──────────────────────────────────────────────────────
    const log = getLogger();
    log.info('LaTeX Citation Assistant activating...');

    // ── 2. Configuration ───────────────────────────────────────────────
    const config = getConfig();
    log.debug(`Configuration loaded: ${JSON.stringify(config, null, 2)}`);

    // ── 3. Source clients ──────────────────────────────────────────────
    const zoteroSource = new ZoteroSource(
        config.zotero.apiKey,
        config.zotero.userId,
    );
    const s2Source = new SemanticScholarSource(
        config.semanticScholar.apiKey,
    );

    if (config.zotero.enabled && zoteroSource.isConfigured()) {
        log.info('Zotero source initialised');
    } else if (config.zotero.enabled) {
        log.warn('Zotero enabled but API key or user ID is missing');
    }

    log.info(
        config.semanticScholar.enabled
            ? 'Semantic Scholar source initialised'
            : 'Semantic Scholar source disabled',
    );

    // ── 4. Core components ─────────────────────────────────────────────
    const ranker = new ResultRanker();
    const llmProvider = createLLMProvider(config.llm);
    if (llmProvider) {
        log.info(`LLM provider initialised: ${llmProvider.name}`);
    } else if (config.llm.enabled) {
        log.warn('LLM enabled but not configured (API key missing, or for openai neither key nor baseUrl set)');
    }
    const engine = new SearchEngine(zoteroSource, s2Source, ranker, llmProvider);
    const bibtexWriter = new BibtexWriter();
    const statusBar = new StatusBarManager();
    const picker = new CitationPicker(bibtexWriter);
    const citationPanel = new CitationPanel(bibtexWriter);
    const extractor = new ContextExtractor();

    context.subscriptions.push(statusBar);

    // ── 5. Commands ────────────────────────────────────────────────────

    // --- latex-cite.suggest (Ctrl+Shift+Z) ---
    const suggestCmd = vscode.commands.registerCommand(
        'latex-cite.suggest',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor.');
                return;
            }

            if (!isLatexDocument(editor.document)) {
                vscode.window.showWarningMessage(
                    'Citation suggestions are only available in LaTeX files.',
                );
                return;
            }

            const currentConfig = getConfig();

            try {
                statusBar.showBusy('Analyzing context...');

                // Extract context at cursor.
                const text = editor.document.getText();
                const cursorOffset = editor.document.offsetAt(
                    editor.selection.active,
                );
                const docContext = extractor.extractContext(
                    text,
                    cursorOffset,
                    currentConfig.contextSentences,
                );

                log.info('─── Context Analysis ───');
                log.info(`Section: ${docContext.section}`);
                log.info(`Key terms: ${docContext.keyTerms.join(', ')}`);
                log.info(`Document type: ${docContext.documentType}`);
                log.info(
                    `Existing citations: ${docContext.existingCitations.length}`,
                );

                statusBar.showBusy('Searching...');

                // Determine which sources to query.
                const sources: CitationSource[] = [];
                if (
                    currentConfig.zotero.enabled &&
                    zoteroSource.isConfigured()
                ) {
                    sources.push(CitationSource.Zotero);
                }
                if (currentConfig.semanticScholar.enabled) {
                    sources.push(CitationSource.SemanticScholar);
                }

                if (sources.length === 0) {
                    vscode.window.showWarningMessage(
                        'No citation sources are configured. ' +
                        'Please enable Zotero or Semantic Scholar in settings.',
                    );
                    statusBar.showReady();
                    return;
                }

                const response = await engine.search({
                    context: docContext,
                    maxResultsPerSource: currentConfig.maxResults,
                    sources,
                });

                // Update status bar with counts.
                const zoteroCount = response.sourceStats
                    .filter((s) => s.source === CitationSource.Zotero)
                    .reduce((acc, s) => acc + s.returned, 0);
                const s2Count = response.sourceStats
                    .filter(
                        (s) => s.source === CitationSource.SemanticScholar,
                    )
                    .reduce((acc, s) => acc + s.returned, 0);
                statusBar.showResults(zoteroCount, s2Count);

                // Show results in webview panel (fall back to QuickPick on error).
                try {
                    await citationPanel.showResults(
                        response.results,
                        response.totalDurationMs,
                        editor,
                        editor.selection.active,
                        currentConfig,
                    );
                } catch (panelErr) {
                    log.warn(
                        `Webview panel failed: ${panelErr instanceof Error ? panelErr.message : panelErr}. `
                        + 'Falling back to QuickPick.',
                    );
                    await picker.showResults(
                        response.results,
                        editor,
                        editor.selection.active,
                        currentConfig,
                    );
                }
            } catch (err) {
                const msg =
                    err instanceof Error ? err.message : String(err);
                log.error(`Suggest command failed: ${msg}`);
                statusBar.showError('Search failed');
                vscode.window.showErrorMessage(
                    `Citation search failed: ${msg}`,
                );
            }
        },
    );

    // --- latex-cite.suggestZotero ---
    const suggestZoteroCmd = vscode.commands.registerCommand(
        'latex-cite.suggestZotero',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor.');
                return;
            }

            const currentConfig = getConfig();

            if (!currentConfig.zotero.enabled || !zoteroSource.isConfigured()) {
                vscode.window.showWarningMessage(
                    'Zotero is not configured. ' +
                    'Please set your API key and user ID in the extension settings.',
                );
                return;
            }

            const term = await vscode.window.showInputBox({
                prompt: 'Search your Zotero library',
                placeHolder: 'Enter search term (title, author, keyword...)',
            });

            if (!term) {
                return;
            }

            try {
                statusBar.showBusy('Searching Zotero...');
                log.info(`Zotero manual search: "${term}"`);

                const results = await zoteroSource.searchByTerm(
                    term,
                    currentConfig.maxResults,
                );

                statusBar.showResults(results.length, 0);

                // Rank with a minimal context (term-based).
                const minimalContext: DocumentContext = {
                    section: '',
                    keyTerms: term.split(/\s+/).filter((t) => t.length > 2),
                    contextText: term,
                    currentParagraph: term,
                    existingCitations: [],
                    documentType: '',
                    documentTitle: '',
                    documentAbstract: '',
                };

                const ranked = ranker.rankResults(results, minimalContext);

                await picker.showResults(
                    ranked,
                    editor,
                    editor.selection.active,
                    currentConfig,
                );
            } catch (err) {
                const msg =
                    err instanceof Error ? err.message : String(err);
                log.error(`Zotero search failed: ${msg}`);
                statusBar.showError('Zotero search failed');
                vscode.window.showErrorMessage(
                    `Zotero search failed: ${msg}`,
                );
            }
        },
    );

    // --- latex-cite.suggestSemanticScholar (Ctrl+Shift+S) ---
    const suggestS2Cmd = vscode.commands.registerCommand(
        'latex-cite.suggestSemanticScholar',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor.');
                return;
            }

            const currentConfig = getConfig();

            const term = await vscode.window.showInputBox({
                prompt: 'Search Semantic Scholar',
                placeHolder: 'Enter search term (title, topic, keyword...)',
            });

            if (!term) {
                return;
            }

            try {
                statusBar.showBusy('Searching Semantic Scholar...');
                log.info(`Semantic Scholar manual search: "${term}"`);

                const results = await s2Source.searchByTerm(
                    term,
                    currentConfig.maxResults,
                );

                statusBar.showResults(0, results.length);

                // Rank with a minimal context.
                const minimalContext: DocumentContext = {
                    section: '',
                    keyTerms: term.split(/\s+/).filter((t) => t.length > 2),
                    contextText: term,
                    currentParagraph: term,
                    existingCitations: [],
                    documentType: '',
                    documentTitle: '',
                    documentAbstract: '',
                };

                const ranked = ranker.rankResults(results, minimalContext);

                await picker.showResults(
                    ranked,
                    editor,
                    editor.selection.active,
                    currentConfig,
                );
            } catch (err) {
                const msg =
                    err instanceof Error ? err.message : String(err);
                log.error(`Semantic Scholar search failed: ${msg}`);
                statusBar.showError('S2 search failed');
                vscode.window.showErrorMessage(
                    `Semantic Scholar search failed: ${msg}`,
                );
            }
        },
    );

    // --- latex-cite.analyzeContext ---
    const analyzeCmd = vscode.commands.registerCommand(
        'latex-cite.analyzeContext',
        () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor.');
                return;
            }

            if (!isLatexDocument(editor.document)) {
                vscode.window.showWarningMessage(
                    'Context analysis is only available in LaTeX files.',
                );
                return;
            }

            const currentConfig = getConfig();

            try {
                const text = editor.document.getText();
                const cursorOffset = editor.document.offsetAt(
                    editor.selection.active,
                );
                const docContext = extractor.extractContext(
                    text,
                    cursorOffset,
                    currentConfig.contextSentences,
                );

                log.info('');
                log.info('=== Document Context Analysis ===');
                log.info(`Section:       ${docContext.section || '(not detected)'}`);
                log.info(`Document type: ${docContext.documentType || '(not detected)'}`);
                log.info(`Key terms:     ${docContext.keyTerms.join(', ') || '(none)'}`);
                log.info(`Context text:  "${docContext.contextText}"`);
                log.info(
                    `Existing citations (${docContext.existingCitations.length}): ` +
                    `${docContext.existingCitations.slice(0, 20).join(', ')}` +
                    (docContext.existingCitations.length > 20 ? '...' : ''),
                );
                log.info('=================================');
                log.info('');
                log.show();

                vscode.window.showInformationMessage(
                    `Context: section="${docContext.section}", ` +
                    `${docContext.keyTerms.length} key terms, ` +
                    `${docContext.existingCitations.length} existing citations. ` +
                    `See output channel for details.`,
                );
            } catch (err) {
                const msg =
                    err instanceof Error ? err.message : String(err);
                log.error(`Context analysis failed: ${msg}`);
                vscode.window.showErrorMessage(
                    `Context analysis failed: ${msg}`,
                );
            }
        },
    );

    // ── 6. Register disposables ────────────────────────────────────────
    context.subscriptions.push(
        suggestCmd,
        suggestZoteroCmd,
        suggestS2Cmd,
        analyzeCmd,
    );

    log.info('LaTeX Citation Assistant activated');
}

/**
 * Deactivate the extension.
 *
 * Called by VS Code when the extension is deactivated. The logger and
 * status bar are disposed automatically through the subscriptions
 * chain, so this function can remain minimal.
 */
export function deactivate(): void {
    const log = getLogger();
    log.info('LaTeX Citation Assistant deactivated');
    log.dispose();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Check whether a document is a LaTeX file.
 *
 * @param document - The VS Code text document.
 * @returns `true` if the language ID is `latex` or `tex`.
 */
function isLatexDocument(document: vscode.TextDocument): boolean {
    return document.languageId === 'latex' || document.languageId === 'tex';
}

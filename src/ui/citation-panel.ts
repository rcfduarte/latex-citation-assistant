/**
 * WebviewPanel manager for the Citation Suggestions panel.
 *
 * Creates a compact webview panel beside the editor that displays
 * paper cards with full metadata. Handles citation insertion
 * and BibTeX writing on user action.
 *
 * @module ui/citation-panel
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import {
    CitationResult,
    CitationSource,
    ExtensionConfig,
} from '../types';
import { BibtexWriter } from '../bibtex/writer';
import { getLogger } from '../utils/logger';
import { generateWebviewHtml } from './webview';

/**
 * Manages a WebviewPanel for displaying citation search results.
 *
 * Opens as a compact panel beside the editor.
 */
export class CitationPanel {
    private panel: vscode.WebviewPanel | undefined;
    private bibtexWriter: BibtexWriter;
    private messageDisposable: vscode.Disposable | undefined;

    /** Current search state (updated on each showResults call). */
    private currentResults: CitationResult[] = [];
    private currentEditor: vscode.TextEditor | undefined;
    private currentPosition: vscode.Position | undefined;
    private currentConfig: ExtensionConfig | undefined;

    constructor(bibtexWriter: BibtexWriter) {
        this.bibtexWriter = bibtexWriter;
    }

    /**
     * Show citation results in a webview panel beside the editor.
     */
    async showResults(
        results: CitationResult[],
        durationMs: number,
        editor: vscode.TextEditor,
        position: vscode.Position,
        config: ExtensionConfig,
    ): Promise<void> {
        if (results.length === 0) {
            vscode.window.showInformationMessage(
                'No citation suggestions found for the current context.',
            );
            return;
        }

        // Update current state
        this.currentResults = results;
        this.currentEditor = editor;
        this.currentPosition = position;
        this.currentConfig = config;

        const nonce = crypto.randomBytes(16).toString('hex');

        // Create or reuse the panel
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Beside, true);
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'citationSuggestions',
                'Citation Suggestions',
                { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
                {
                    enableScripts: true,
                    retainContextWhenHidden: false,
                },
            );

            this.panel.onDidDispose(() => {
                this.messageDisposable?.dispose();
                this.messageDisposable = undefined;
                this.panel = undefined;
            });

            // Register message handler ONCE
            this.messageDisposable = this.panel.webview.onDidReceiveMessage(
                (msg) => this.handleMessage(msg),
            );
        }

        // Set the HTML content
        this.panel.webview.html = generateWebviewHtml(results, durationMs, nonce);
    }

    private async handleMessage(
        message: { type: string; index?: number; indices?: number[]; url?: string },
    ): Promise<void> {
        const log = getLogger();

        if (message.type === 'insertCitation' && message.index !== undefined) {
            await this.insertResults([message.index]);
        } else if (message.type === 'insertMultiple' && message.indices?.length) {
            await this.insertResults(message.indices);
        } else if (message.type === 'openUrl' && message.url) {
            vscode.env.openExternal(vscode.Uri.parse(message.url));
        }
    }

    /**
     * Insert one or more citations at the cursor position.
     *
     * Single result: `\cite{key}`
     * Multiple results: `\cite{key1, key2, key3}`
     */
    private async insertResults(indices: number[]): Promise<void> {
        const log = getLogger();
        const editor = this.currentEditor;
        const position = this.currentPosition;
        const config = this.currentConfig;

        if (!editor || !position || !config) {
            return;
        }

        // Collect valid results
        const results = indices
            .map((i) => this.currentResults[i])
            .filter((r): r is CitationResult => !!r);

        if (results.length === 0) {
            return;
        }

        try {
            // Build \cite{key1, key2, ...}
            const keys = results.map((r) => r.bibtexKey).join(', ');
            const citationText = `${config.citationCommand}{${keys}}`;

            await editor.edit((editBuilder) => {
                editBuilder.insert(position, citationText);
            });

            log.info(`Inserted ${citationText}`);

            // Write BibTeX entries for all S2 results
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                const root = workspaceFolders[0].uri.fsPath;
                for (const result of results) {
                    if (result.source === CitationSource.SemanticScholar && result.bibtexEntry) {
                        try {
                            await this.bibtexWriter.writeEntry(
                                result,
                                root,
                                config.suggestionsBibFile,
                            );
                        } catch (err) {
                            const msg = err instanceof Error ? err.message : String(err);
                            log.error(`Failed to write BibTeX for ${result.bibtexKey}: ${msg}`);
                        }
                    }
                }
            }

            vscode.window.showInformationMessage(`Inserted ${citationText}`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.error(`Failed to insert citation: ${msg}`);
            vscode.window.showErrorMessage(`Failed to insert citation: ${msg}`);
        }
    }

    dispose(): void {
        this.messageDisposable?.dispose();
        this.messageDisposable = undefined;
        this.panel?.dispose();
        this.panel = undefined;
    }
}

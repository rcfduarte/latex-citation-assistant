/**
 * Enhanced QuickPick UI for displaying citation search results.
 *
 * Presents ranked {@link CitationResult} objects as richly formatted
 * QuickPick items grouped by source, with source-specific icons and
 * metadata. On selection the citation command is inserted at the cursor
 * and -- for Semantic Scholar results -- the BibTeX entry is written to
 * the suggestions file.
 *
 * @module ui/quick-pick
 */

import * as vscode from 'vscode';
import {
    CitationQuickPickItem,
    CitationResult,
    CitationSource,
    ExtensionConfig,
} from '../types';
import { BibtexWriter } from '../bibtex/writer';
import { getLogger } from '../utils/logger';

/**
 * Shows citation search results in a VS Code QuickPick and handles
 * the user's selection.
 *
 * @example
 * ```ts
 * const picker = new CitationPicker(bibtexWriter);
 * await picker.showResults(rankedResults, editor, cursorPos, config);
 * ```
 */
export class CitationPicker {
    private bibtexWriter: BibtexWriter;

    /**
     * @param bibtexWriter - Writer used to persist BibTeX entries from
     *                       Semantic Scholar results.
     */
    constructor(bibtexWriter: BibtexWriter) {
        this.bibtexWriter = bibtexWriter;
    }

    /**
     * Display ranked results in an enhanced QuickPick dialog.
     *
     * Results are grouped into two sections separated by visual
     * headers:
     * 1. "From Your Zotero Library" (if any Zotero results)
     * 2. "From Semantic Scholar" (if any S2 results)
     *
     * Each item shows a source-specific icon, the paper title,
     * abbreviated author list, journal, year, citation count (S2 only),
     * and relevance score.
     *
     * When the user selects an item:
     * - The configured citation command (e.g. `\cite{key}`) is inserted
     *   at the cursor position.
     * - For Semantic Scholar results, the BibTeX entry is also appended
     *   to the suggestions `.bib` file.
     * - A brief confirmation message is shown.
     *
     * @param results  - Ranked citation results to display.
     * @param editor   - The active text editor where the citation will
     *                   be inserted.
     * @param position - The cursor position for insertion.
     * @param config   - The extension configuration (used for citation
     *                   command and bib file path).
     */
    async showResults(
        results: CitationResult[],
        editor: vscode.TextEditor,
        position: vscode.Position,
        config: ExtensionConfig,
    ): Promise<void> {
        const log = getLogger();

        if (results.length === 0) {
            vscode.window.showInformationMessage(
                'No citation suggestions found for the current context.',
            );
            return;
        }

        // Build QuickPick items grouped by source.
        const items = this.buildItems(results);

        // Create and configure the QuickPick.
        const quickPick = vscode.window.createQuickPick<CitationQuickPickItem>();
        quickPick.items = items;
        quickPick.placeholder = 'Select a citation to insert';
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;
        quickPick.title = `Citation Suggestions (${results.length} results)`;

        // Handle selection.
        const selection = await new Promise<CitationQuickPickItem | undefined>(
            (resolve) => {
                quickPick.onDidAccept(() => {
                    const selected = quickPick.selectedItems[0];
                    quickPick.hide();
                    resolve(selected);
                });

                quickPick.onDidHide(() => {
                    quickPick.dispose();
                    resolve(undefined);
                });

                quickPick.show();
            },
        );

        if (!selection || !selection.citation) {
            return;
        }

        const result = selection.citation;

        // 1. Insert citation at cursor.
        const citationText = `${config.citationCommand}{${result.bibtexKey}}`;
        await editor.edit((editBuilder) => {
            editBuilder.insert(position, citationText);
        });

        log.info(`Inserted ${citationText}`);

        // 2. Write BibTeX entry for Semantic Scholar results.
        if (result.source === CitationSource.SemanticScholar) {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                const workspaceRoot = workspaceFolders[0].uri.fsPath;
                try {
                    await this.bibtexWriter.writeEntry(
                        result,
                        workspaceRoot,
                        config.suggestionsBibFile,
                    );
                } catch (err) {
                    const msg =
                        err instanceof Error ? err.message : String(err);
                    log.error(`Failed to write BibTeX entry: ${msg}`);
                    vscode.window.showWarningMessage(
                        `Citation inserted but failed to write BibTeX: ${msg}`,
                    );
                }
            }
        }

        // 3. Confirmation message.
        const sourceLabel =
            result.source === CitationSource.Zotero
                ? 'Zotero'
                : 'Semantic Scholar';
        const confirmMsg = `Inserted ${citationText} (from ${sourceLabel})`;
        const action = await vscode.window.showInformationMessage(
            confirmMsg,
            'Show Details',
        );

        if (action === 'Show Details') {
            this.showPaperDetails(result);
        }
    }

    // ─── Private helpers ────────────────────────────────────────────────────

    /**
     * Build the QuickPick item list with source-group separators.
     *
     * @param results - Ranked results to convert.
     * @returns An array of {@link CitationQuickPickItem} objects including
     *          separator items.
     */
    private buildItems(results: CitationResult[]): CitationQuickPickItem[] {
        const items: CitationQuickPickItem[] = [];

        const zoteroResults = results.filter(
            (r) => r.source === CitationSource.Zotero,
        );
        const s2Results = results.filter(
            (r) => r.source === CitationSource.SemanticScholar,
        );

        // Zotero section.
        if (zoteroResults.length > 0) {
            items.push(this.createSeparator(
                '\u2501\u2501 From Your Zotero Library \u2501\u2501',
            ));
            for (const result of zoteroResults) {
                items.push(this.createResultItem(result));
            }
        }

        // Semantic Scholar section.
        if (s2Results.length > 0) {
            items.push(this.createSeparator(
                '\u2501\u2501 From Semantic Scholar \u2501\u2501',
            ));
            for (const result of s2Results) {
                items.push(this.createResultItem(result));
            }
        }

        return items;
    }

    /**
     * Create a separator item for grouping results by source.
     *
     * Uses `QuickPickItemKind.Separator` (numeric value 1) so the
     * QuickPick renders it as a non-selectable divider.
     *
     * @param label - The separator text.
     * @returns A separator {@link CitationQuickPickItem}.
     */
    private createSeparator(label: string): CitationQuickPickItem {
        return {
            label,
            description: '',
            detail: '',
            citation: undefined as unknown as CitationResult,
            kind: vscode.QuickPickItemKind.Separator,
        };
    }

    /**
     * Create a QuickPick item for a single citation result.
     *
     * @param result - The citation result.
     * @returns A richly formatted {@link CitationQuickPickItem}.
     */
    private createResultItem(result: CitationResult): CitationQuickPickItem {
        // Label: full title (no icon -- source is indicated by section separator)
        const label = result.title;

        // Description (right of title): compact author/year + score
        const authorStr = this.formatShortAuthors(result);
        const scoreStr = `[${result.relevanceScore}]`;
        const description = authorStr ? `${authorStr} ${scoreStr}` : scoreStr;

        // Detail line (second row): journal, citation count, relevance reason
        const detailParts: string[] = [];
        if (result.journal) {
            detailParts.push(result.journal);
        }
        if (
            result.source === CitationSource.SemanticScholar &&
            result.citationCount !== undefined
        ) {
            detailParts.push(`Cited ${result.citationCount}x`);
        }
        if (result.relevanceReason) {
            detailParts.push(result.relevanceReason);
        }

        return {
            label,
            description,
            detail: detailParts.length > 0 ? detailParts.join(' \u2022 ') : undefined as unknown as string,
            citation: result,
        };
    }

    /**
     * Format a short author string for display in the QuickPick.
     *
     * Produces "LastName et al., Year" for multi-author papers, or
     * "LastName, Year" for single-author papers.
     *
     * @param result - The citation result.
     * @returns A compact author/year string.
     */
    private formatShortAuthors(result: CitationResult): string {
        const authors = result.authors;
        if (!authors || authors.length === 0) {
            return result.year !== null ? String(result.year) : '';
        }

        const first =
            authors[0].lastName || authors[0].name || 'Unknown';
        const suffix = authors.length > 1 ? ' et al.' : '';
        const year =
            result.year !== null && result.year !== undefined
                ? `, ${result.year}`
                : '';

        return `${first}${suffix}${year}`;
    }

    /**
     * Show full paper details in the output channel.
     *
     * @param result - The citation result whose details to display.
     */
    private showPaperDetails(result: CitationResult): void {
        const log = getLogger();
        log.info('─── Paper Details ───────────────────────────────────');
        log.info(`Title:    ${result.title}`);
        log.info(
            `Authors:  ${result.authors
                .map(
                    (a) =>
                        a.lastName && a.firstName
                            ? `${a.lastName}, ${a.firstName}`
                            : a.name || 'Unknown',
                )
                .join('; ')}`,
        );
        log.info(`Year:     ${result.year ?? 'N/A'}`);
        log.info(`Journal:  ${result.journal || 'N/A'}`);
        log.info(`DOI:      ${result.doi || 'N/A'}`);
        log.info(`URL:      ${result.url || 'N/A'}`);
        log.info(`BibKey:   ${result.bibtexKey}`);
        log.info(`Source:   ${result.source}`);
        if (result.citationCount !== undefined) {
            log.info(`Citations: ${result.citationCount}`);
        }
        log.info(`Score:    ${result.relevanceScore}/100`);
        if (result.abstract) {
            log.info(`Abstract: ${result.abstract}`);
        }
        log.info('─────────────────────────────────────────────────────');
        log.show();
    }
}

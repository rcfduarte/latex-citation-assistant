/**
 * BibTeX file writer for the LaTeX Citation Assistant.
 *
 * Handles appending new BibTeX entries to `.bib` files, generating
 * properly formatted entries from {@link CitationResult} objects, and
 * avoiding duplicate keys. This module is the only code path that
 * touches the filesystem for bibliography output, keeping file I/O
 * concerns isolated from the search and UI layers.
 *
 * @module bibtex/writer
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Author, CitationResult } from '../types';
import { getLogger } from '../utils/logger';

/**
 * Manages writing and generating BibTeX entries.
 *
 * @example
 * ```ts
 * const writer = new BibtexWriter();
 *
 * // Write an existing bibtexEntry field to disk
 * await writer.writeEntry(result, '/home/user/paper', 'suggestions.bib');
 *
 * // Generate a new BibTeX string from structured data
 * const bib = writer.generateBibtexEntry(result);
 * ```
 */
export class BibtexWriter {
    /**
     * Append a BibTeX entry to a `.bib` file.
     *
     * The method is idempotent: if the citation key already exists in the
     * target file the write is silently skipped (with an info log).
     *
     * @param entry         - The citation result whose `bibtexEntry` (or a
     *                        generated entry) will be written.
     * @param workspaceRoot - Absolute path to the workspace root directory.
     * @param bibFileName   - Relative path to the `.bib` file within the
     *                        workspace (e.g. `"suggestions.bib"`).
     */
    async writeEntry(
        entry: CitationResult,
        workspaceRoot: string,
        bibFileName: string,
    ): Promise<void> {
        const log = getLogger();
        const fullPath = path.join(workspaceRoot, bibFileName);

        // Read existing content (or start from empty).
        let existingContent = '';
        try {
            existingContent = fs.readFileSync(fullPath, 'utf-8');
        } catch {
            // File does not exist yet -- that is fine.
            log.info(`Creating new BibTeX file: ${fullPath}`);
        }

        // Check for duplicate key.
        const keyPattern = new RegExp(
            `@\\w+\\{${this.escapeRegex(entry.bibtexKey)},`,
        );
        if (keyPattern.test(existingContent)) {
            log.info(
                `Key "${entry.bibtexKey}" already exists in ${bibFileName} -- skipping`,
            );
            return;
        }

        // Use the existing bibtexEntry if available, otherwise generate one.
        const bibtex = entry.bibtexEntry || this.generateBibtexEntry(entry);

        // Append with a blank line separator.
        const separator = existingContent.length > 0 ? '\n\n' : '';
        const newContent = existingContent + separator + bibtex + '\n';

        // Ensure the parent directory exists.
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(fullPath, newContent, 'utf-8');

        log.info(`Added ${entry.bibtexKey} to ${bibFileName}`);
        vscode.window.showInformationMessage(
            `Added ${entry.bibtexKey} to ${bibFileName}`,
        );
    }

    /**
     * Generate a formatted BibTeX entry string from a {@link CitationResult}.
     *
     * Handles:
     * - Choosing the appropriate entry type (`@article`, `@inproceedings`,
     *   `@book`, or `@misc` as fallback).
     * - Formatting multiple authors as `"LastName, FirstName and ..."`.
     * - Escaping BibTeX-special characters in the title.
     * - Including DOI, abstract, and URL when available.
     *
     * @param result - The citation data to format.
     * @returns A complete BibTeX entry string.
     */
    generateBibtexEntry(result: CitationResult): string {
        const entryType = this.mapItemType(result.itemType);
        const authors = this.formatAuthors(result.authors);
        const title = this.escapeBibtex(result.title);

        const fields: string[] = [];
        fields.push(`  author    = {${authors}}`);
        fields.push(`  title     = {${title}}`);

        if (result.year !== null && result.year !== undefined) {
            fields.push(`  year      = {${result.year}}`);
        }

        if (result.journal) {
            const journalField =
                entryType === 'inproceedings' ? 'booktitle' : 'journal';
            fields.push(`  ${journalField.padEnd(9)} = {${this.escapeBibtex(result.journal)}}`);
        }

        if (result.doi) {
            fields.push(`  doi       = {${result.doi}}`);
        }

        if (result.url) {
            fields.push(`  url       = {${result.url}}`);
        }

        if (result.abstract) {
            fields.push(`  abstract  = {${this.escapeBibtex(result.abstract)}}`);
        }

        return `@${entryType}{${result.bibtexKey},\n${fields.join(',\n')}\n}`;
    }

    // ─── Private helpers ────────────────────────────────────────────────────

    /**
     * Map a free-form item type string to a BibTeX entry type.
     *
     * @param itemType - The item type from the citation result
     *                   (e.g. "journalArticle", "conferencePaper").
     * @returns A BibTeX entry type string.
     */
    private mapItemType(itemType: string): string {
        const lower = (itemType || '').toLowerCase();

        if (
            lower.includes('article') ||
            lower.includes('journal') ||
            lower === 'journalarticle'
        ) {
            return 'article';
        }
        if (
            lower.includes('conference') ||
            lower.includes('inproceedings') ||
            lower.includes('proceedings') ||
            lower === 'conferencepaper'
        ) {
            return 'inproceedings';
        }
        if (lower === 'book') {
            return 'book';
        }
        if (lower.includes('chapter') || lower.includes('incollection')) {
            return 'incollection';
        }
        if (lower.includes('thesis') || lower.includes('dissertation')) {
            return 'phdthesis';
        }
        if (lower.includes('report') || lower.includes('techreport')) {
            return 'techreport';
        }
        if (lower.includes('preprint')) {
            return 'article';
        }

        return 'misc';
    }

    /**
     * Format an array of authors into BibTeX `"Last, First and Last, First"`
     * notation.
     *
     * If only a `name` field is available (no `firstName`/`lastName` split),
     * it is used as-is.
     *
     * @param authors - The author list from the citation result.
     * @returns A BibTeX-formatted author string.
     */
    private formatAuthors(authors: Author[]): string {
        if (!authors || authors.length === 0) {
            return 'Unknown';
        }

        return authors
            .map((a) => {
                if (a.lastName && a.firstName) {
                    return `${a.lastName}, ${a.firstName}`;
                }
                if (a.lastName) {
                    return a.lastName;
                }
                if (a.name) {
                    return a.name;
                }
                return 'Unknown';
            })
            .join(' and ');
    }

    /**
     * Escape characters that are special in BibTeX field values.
     *
     * Replaces `&`, `%`, `#`, `_`, `{`, `}`, `~`, and `^` with their
     * backslash-escaped counterparts.
     *
     * @param text - The raw text to escape.
     * @returns The escaped string safe for inclusion in a BibTeX field.
     */
    private escapeBibtex(text: string): string {
        if (!text) {
            return '';
        }

        return text
            .replace(/&/g, '\\&')
            .replace(/%/g, '\\%')
            .replace(/#/g, '\\#')
            .replace(/_/g, '\\_')
            .replace(/\^/g, '\\^')
            .replace(/~/g, '\\~');
        // Deliberately not escaping { } -- they are valid delimiters in
        // BibTeX values and are often used intentionally (e.g. {DNA}).
    }

    /**
     * Escape a string for use in a JavaScript RegExp.
     *
     * @param str - The raw string.
     * @returns The regex-safe string.
     */
    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

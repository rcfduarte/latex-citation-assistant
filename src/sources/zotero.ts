/**
 * Zotero API client for the LaTeX Citation Assistant.
 *
 * Uses server-side search via the Zotero Web API v3 to find relevant
 * items in the user's library. Unlike naive approaches that fetch a
 * fixed batch and filter locally, this client builds targeted queries
 * from document context and executes them in parallel, yielding much
 * better recall for large libraries.
 *
 * @see https://www.zotero.org/support/dev/web_api/v3/basics
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import {
    CitationResult,
    CitationSource,
    Author,
    DocumentContext,
} from '../types';
import { getLogger } from '../utils/logger';

// ─── Constants ──────────────────────────────────────────────────────────────

const ZOTERO_API_BASE = 'https://api.zotero.org';
const ZOTERO_API_VERSION = '3';

/** Maximum items the Zotero API will return per request. */
const MAX_PER_REQUEST = 25;

/** Request timeout in milliseconds. */
const REQUEST_TIMEOUT_MS = 25_000;

/**
 * Exclude attachment and note item types from search results.
 * Axios will handle URL encoding, so use the raw (unencoded) form.
 */
const EXCLUDED_ITEM_TYPES = '-attachment || note';

// ─── Zotero API response types (partial) ────────────────────────────────────

/** Shape of a single Zotero item returned by the API (relevant fields only). */
interface ZoteroCreator {
    creatorType: string;
    firstName?: string;
    lastName?: string;
    name?: string;
}

interface ZoteroItemData {
    key: string;
    itemType: string;
    title?: string;
    creators?: ZoteroCreator[];
    date?: string;
    publicationTitle?: string;
    abstractNote?: string;
    DOI?: string;
    url?: string;
    extra?: string;
}

interface ZoteroItem {
    key: string;
    data: ZoteroItemData;
}

// ─── ZoteroSource ───────────────────────────────────────────────────────────

/**
 * Citation source backed by the Zotero Web API.
 *
 * @example
 * ```ts
 * const zotero = new ZoteroSource(apiKey, userId);
 * if (zotero.isConfigured()) {
 *     const results = await zotero.search(context, 20);
 * }
 * ```
 */
export class ZoteroSource {
    private readonly client: AxiosInstance;
    private readonly userId: string;
    private readonly apiKey: string;

    /**
     * Create a new Zotero API client.
     *
     * @param apiKey - Zotero API key obtained from https://www.zotero.org/settings/keys
     * @param userId - Numeric Zotero user ID (shown on the same settings page)
     */
    constructor(apiKey: string, userId: string) {
        this.apiKey = apiKey;
        this.userId = userId;

        this.client = axios.create({
            baseURL: `${ZOTERO_API_BASE}/users/${userId}`,
            timeout: REQUEST_TIMEOUT_MS,
            headers: {
                'Zotero-API-Version': ZOTERO_API_VERSION,
                'Authorization': `Bearer ${apiKey}`,
            },
        });
    }

    // ── Public API ──────────────────────────────────────────────────────────

    /**
     * Search the Zotero library using context-derived queries.
     *
     * The method constructs multiple overlapping queries from the document's
     * key terms and runs them in parallel. Results are deduplicated by item
     * key and capped at {@link maxResults}.
     *
     * @param context   - Extracted document context containing key terms
     * @param maxResults - Maximum number of results to return
     * @returns Deduplicated citation results sorted by query order
     */
    async search(
        context: DocumentContext,
        maxResults: number,
    ): Promise<CitationResult[]> {
        const queries = this.buildSearchQueries(context.keyTerms);

        if (queries.length === 0) {
            return [];
        }

        const perQuery = Math.min(MAX_PER_REQUEST, maxResults);
        const requests = queries.map((q) => this.executeSearch(q, perQuery));

        const settled = await Promise.allSettled(requests);

        // Merge results, deduplicating by Zotero item key.
        const seen = new Map<string, CitationResult>();

        for (const outcome of settled) {
            if (outcome.status === 'fulfilled') {
                for (const result of outcome.value) {
                    if (!seen.has(result.sourceId)) {
                        seen.set(result.sourceId, result);
                    }
                }
            }
            // Rejected promises are already logged inside executeSearch.
        }

        return Array.from(seen.values()).slice(0, maxResults);
    }

    /**
     * Search the Zotero library with a single query string.
     *
     * Useful for direct user-initiated searches (e.g., command palette).
     *
     * @param term       - Free-text search term
     * @param maxResults - Maximum number of results
     * @returns Citation results matching the term
     */
    async searchByTerm(
        term: string,
        maxResults: number,
    ): Promise<CitationResult[]> {
        return this.executeSearch(term, Math.min(maxResults, MAX_PER_REQUEST));
    }

    /**
     * Check whether the client has the credentials needed to make API calls.
     *
     * @returns `true` if both apiKey and userId are non-empty strings
     */
    isConfigured(): boolean {
        return this.apiKey.length > 0 && this.userId.length > 0;
    }

    /**
     * Search the Zotero library using LLM-generated queries sequentially.
     *
     * Each query is run as a separate Zotero API call with a small delay
     * between them to avoid overwhelming the API (parallel requests cause
     * timeouts on large libraries). Results are deduplicated by item key.
     *
     * @param queries    - Array of search query strings from the LLM.
     * @param maxResults - Maximum total results to return.
     * @returns Deduplicated citation results from all queries.
     */
    async searchWithQueries(
        queries: string[],
        maxResults: number,
    ): Promise<CitationResult[]> {
        if (queries.length === 0 || !this.isConfigured()) {
            return [];
        }

        const perQuery = Math.min(MAX_PER_REQUEST, maxResults);
        const seen = new Map<string, CitationResult>();

        for (let i = 0; i < queries.length; i++) {
            if (i > 0) {
                await new Promise((r) => setTimeout(r, 500));
            }

            try {
                const results = await this.executeSearch(queries[i], perQuery);
                for (const result of results) {
                    if (!seen.has(result.sourceId)) {
                        seen.set(result.sourceId, result);
                    }
                }
            } catch {
                // Individual query failures are non-fatal
            }
        }

        return Array.from(seen.values()).slice(0, maxResults);
    }

    // ── Query construction ──────────────────────────────────────────────────

    /**
     * Build a set of search queries from extracted key terms.
     *
     * Strategy:
     * 1. Group terms into pairs/triples for specificity.
     * 2. Add one broader query with only the top 1-2 terms.
     *
     * @param keyTerms - Ranked list of key terms from context extraction
     * @returns Array of query strings ready for the `q=` parameter
     */
    private buildSearchQueries(keyTerms: string[]): string[] {
        if (keyTerms.length === 0) {
            return [];
        }

        const queries: string[] = [];
        const seen = new Set<string>();

        const addQuery = (q: string) => {
            const normalized = q.toLowerCase().trim();
            if (normalized && !seen.has(normalized)) {
                seen.add(normalized);
                queries.push(q.trim());
            }
        };

        // 1. Each multi-word phrase as its own query (these are already specific)
        for (const term of keyTerms) {
            if (term.includes(' ')) {
                addQuery(term);
            }
        }

        // 2. Each significant single-word term as its own query
        for (const term of keyTerms) {
            if (!term.includes(' ') && term.length >= 4) {
                addQuery(term);
            }
        }

        // 3. One broad query combining the top 2-3 single words
        const singleWords = keyTerms
            .filter(t => !t.includes(' ') && t.length >= 4)
            .slice(0, 3);
        if (singleWords.length >= 2) {
            addQuery(singleWords.join(' '));
        }

        // Cap at 5 queries to avoid excessive API calls
        return queries.slice(0, 5);
    }

    // ── API execution ───────────────────────────────────────────────────────

    /**
     * Execute a single search request against the Zotero API.
     *
     * @param query - Free-text query string
     * @param limit - Maximum items to request (capped at 100 by API)
     * @returns Mapped citation results
     * @throws Re-throws after logging if the error is unexpected
     */
    private async executeSearch(
        query: string,
        limit: number,
    ): Promise<CitationResult[]> {
        try {
            const response = await this.client.get<ZoteroItem[]>('/items', {
                params: {
                    q: query,
                    format: 'json',
                    itemType: EXCLUDED_ITEM_TYPES,
                    limit,
                },
            });

            return (response.data || []).map((item) =>
                this.mapToCitationResult(item),
            );
        } catch (error) {
            this.handleError(error, query);
            return [];
        }
    }

    // ── Result mapping ──────────────────────────────────────────────────────

    /**
     * Convert a raw Zotero API item into the extension's CitationResult format.
     *
     * @param item - Raw Zotero API response item
     * @returns Normalized citation result
     */
    private mapToCitationResult(item: ZoteroItem): CitationResult {
        const data = item.data;

        return {
            sourceId: item.key,
            source: CitationSource.Zotero,
            title: data.title || '',
            authors: this.mapCreators(data.creators),
            year: this.extractYear(data.date),
            journal: data.publicationTitle || '',
            abstract: data.abstractNote || '',
            doi: data.DOI || '',
            bibtexKey: this.extractBibtexKey(data),
            itemType: data.itemType || 'article',
            relevanceScore: 0,
            url: data.url,
        };
    }

    /**
     * Map Zotero creators to the Author interface.
     *
     * Zotero supports two creator formats:
     * - Structured: `{ firstName, lastName }`
     * - Single-field: `{ name }` (used for institutional authors, etc.)
     *
     * @param creators - Array of Zotero creator objects
     * @returns Normalized author list
     */
    private mapCreators(creators?: ZoteroCreator[]): Author[] {
        if (!creators || creators.length === 0) {
            return [];
        }

        return creators.map((creator) => {
            if (creator.firstName || creator.lastName) {
                return {
                    firstName: creator.firstName,
                    lastName: creator.lastName,
                };
            }
            return { name: creator.name };
        });
    }

    /**
     * Extract a four-digit year from a Zotero date string.
     *
     * Zotero date fields can contain various formats: "2023", "2023-05-10",
     * "May 2023", "2023/05/10", etc. We look for the first four-digit number.
     *
     * @param date - Raw date string from Zotero
     * @returns Numeric year, or null if not parseable
     */
    private extractYear(date?: string): number | null {
        if (!date) {
            return null;
        }
        const match = date.match(/\b(\d{4})\b/);
        return match ? parseInt(match[1], 10) : null;
    }

    /**
     * Extract or generate a BibTeX citation key for an item.
     *
     * Checks the Zotero `extra` field for keys set by Better BibTeX:
     * - `bibtex: someKey`
     * - `Citation Key: someKey`
     *
     * Falls back to generating a key from the first author's last name
     * and the publication year (e.g., "Smith2023").
     *
     * @param data - Zotero item data
     * @returns BibTeX citation key
     */
    private extractBibtexKey(data: ZoteroItemData): string {
        // Check Better BibTeX patterns in the extra field
        if (data.extra) {
            // Pattern: "bibtex: keyValue" (case-insensitive)
            const bibtexMatch = data.extra.match(
                /^bibtex\s*:\s*(.+)$/im,
            );
            if (bibtexMatch) {
                return bibtexMatch[1].trim();
            }

            // Pattern: "Citation Key: keyValue"
            const citationKeyMatch = data.extra.match(
                /^Citation Key\s*:\s*(.+)$/im,
            );
            if (citationKeyMatch) {
                return citationKeyMatch[1].trim();
            }
        }

        // Fallback: generate LastNameYear
        return this.generateBibtexKey(data.creators, data.date);
    }

    /**
     * Generate a BibTeX key from the first author's last name and the year.
     *
     * @param creators - Item creators
     * @param date     - Item date string
     * @returns Generated key (e.g., "Smith2023"), or "unknown" as last resort
     */
    private generateBibtexKey(
        creators?: ZoteroCreator[],
        date?: string,
    ): string {
        let lastName = 'unknown';

        if (creators && creators.length > 0) {
            const first = creators[0];
            if (first.lastName) {
                lastName = first.lastName;
            } else if (first.name) {
                // Take last word of the full name as a rough approximation
                const parts = first.name.trim().split(/\s+/);
                lastName = parts[parts.length - 1];
            }
        }

        // Sanitize: keep only ASCII letters
        const sanitized = lastName.replace(/[^a-zA-Z]/g, '');
        const year = this.extractYear(date);
        const yearStr = year !== null ? String(year) : '';

        return `${sanitized}${yearStr}`;
    }

    // ── Error handling ──────────────────────────────────────────────────────

    /**
     * Handle and log Zotero API errors with meaningful messages.
     *
     * @param error - Caught error (typically AxiosError)
     * @param query - The query that triggered the error, for logging context
     */
    private handleError(error: unknown, query: string): void {
        const log = getLogger();

        if (!axios.isAxiosError(error)) {
            log.error(`[Zotero] Unexpected error for "${query}": ${error}`);
            return;
        }

        const axiosErr = error as AxiosError;

        if (axiosErr.code === 'ECONNABORTED' || axiosErr.code === 'ETIMEDOUT') {
            log.error(`[Zotero] Connection timed out for query "${query}"`);
            return;
        }

        const status = axiosErr.response?.status;

        switch (status) {
            case 403:
                log.error('[Zotero] Invalid API key. Check at https://www.zotero.org/settings/keys');
                break;
            case 404:
                log.error(`[Zotero] User not found (userId: ${this.userId}). Verify in settings.`);
                break;
            case 429:
                log.error('[Zotero] Rate limit exceeded. Please wait before retrying.');
                break;
            default:
                log.error(`[Zotero] API error (HTTP ${status ?? 'unknown'}) for query "${query}": ${axiosErr.message}`);
        }
    }
}

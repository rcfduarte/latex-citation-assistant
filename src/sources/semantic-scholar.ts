/**
 * Semantic Scholar API client for the LaTeX Citation Assistant.
 *
 * Uses the Semantic Scholar Academic Graph API to find papers relevant
 * to the current document context. Results include full metadata and
 * generated BibTeX entries ready for insertion into .bib files.
 *
 * Rate limits: 100 requests per 5 minutes without an API key.
 * An optional API key can be provided for higher throughput.
 *
 * @see https://api.semanticscholar.org/api-docs/graph
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

const S2_API_BASE = 'https://api.semanticscholar.org/graph/v1';

/** Fields to request from the paper search endpoint. */
const SEARCH_FIELDS = [
    'paperId',
    'title',
    'abstract',
    'authors',
    'year',
    'citationCount',
    'influentialCitationCount',
    'tldr',
    'externalIds',
    'publicationVenue',
    'url',
    'openAccessPdf',
].join(',');

/** Fields for the Recommendations API (does not support tldr). */
const RECOMMENDATIONS_FIELDS = [
    'paperId',
    'title',
    'abstract',
    'authors',
    'year',
    'citationCount',
    'influentialCitationCount',
    'externalIds',
    'publicationVenue',
    'url',
    'openAccessPdf',
].join(',');

/** Request timeout in milliseconds. */
const REQUEST_TIMEOUT_MS = 20_000;

/** Maximum requests allowed within the rate-limit window (unauthenticated). */
const RATE_LIMIT_MAX_REQUESTS = 100;

/** Rate-limit window duration in milliseconds (5 minutes). */
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1_000;

/**
 * When the number of remaining requests in the current window falls
 * below this threshold, we start inserting delays between requests.
 */
const RATE_LIMIT_WARN_THRESHOLD = 10;

/** Delay injected when approaching the rate limit, in milliseconds. */
const RATE_LIMIT_DELAY_MS = 3_000;

// ─── Semantic Scholar API response types (partial) ──────────────────────────

interface S2Author {
    authorId?: string;
    name: string;
}

interface S2ExternalIds {
    DOI?: string;
    ArXiv?: string;
    PubMed?: string;
    [key: string]: string | undefined;
}

interface S2PublicationVenue {
    id?: string;
    name?: string;
    type?: string;
}

interface S2OpenAccessPdf {
    url: string;
    status?: string;
}

interface S2Tldr {
    model: string;
    text: string;
}

interface S2Paper {
    paperId: string;
    title: string;
    abstract: string | null;
    authors: S2Author[];
    year: number | null;
    citationCount: number | null;
    influentialCitationCount: number | null;
    tldr: S2Tldr | null;
    externalIds: S2ExternalIds | null;
    publicationVenue: S2PublicationVenue | null;
    url: string | null;
    openAccessPdf: S2OpenAccessPdf | null;
}

interface S2SearchResponse {
    total: number;
    offset: number;
    data: S2Paper[];
}

// ─── BibTeX item type mapping ───────────────────────────────────────────────

/**
 * Map a Semantic Scholar venue type to a BibTeX entry type.
 *
 * S2 venue types include "journal", "conference", etc. We default to
 * "article" when the venue type is unrecognized or absent.
 */
function inferBibtexType(venue: S2PublicationVenue | null): string {
    if (!venue?.type) {
        return 'article';
    }
    switch (venue.type.toLowerCase()) {
        case 'conference':
            return 'inproceedings';
        case 'journal':
            return 'article';
        case 'workshop':
            return 'inproceedings';
        case 'book':
            return 'book';
        default:
            return 'article';
    }
}

// ─── SemanticScholarSource ──────────────────────────────────────────────────

/**
 * Citation source backed by the Semantic Scholar Academic Graph API.
 *
 * @example
 * ```ts
 * const s2 = new SemanticScholarSource(); // no key needed for basic use
 * const results = await s2.search(context, 20);
 * ```
 */
export class SemanticScholarSource {
    private readonly client: AxiosInstance;
    private readonly apiKey: string;

    /**
     * Timestamps of recent requests, used for client-side rate-limit tracking.
     * Entries older than {@link RATE_LIMIT_WINDOW_MS} are pruned on each check.
     */
    private requestTimestamps: number[] = [];

    /**
     * Create a new Semantic Scholar API client.
     *
     * @param apiKey - Optional API key for higher rate limits.
     *                 Obtain one at https://www.semanticscholar.org/product/api#api-key
     */
    constructor(apiKey: string = '') {
        this.apiKey = apiKey;

        const headers: Record<string, string> = {};
        if (apiKey) {
            headers['x-api-key'] = apiKey;
        }

        this.client = axios.create({
            baseURL: S2_API_BASE,
            timeout: REQUEST_TIMEOUT_MS,
            headers,
        });
    }

    // ── Public API ──────────────────────────────────────────────────────────

    /**
     * Search Semantic Scholar using context-derived key terms.
     *
     * Joins the top 5-6 key terms into a single query string. S2's search
     * endpoint is already relevance-ranked, so a single well-formed query
     * typically outperforms multiple fragmented ones.
     *
     * @param context    - Extracted document context containing key terms
     * @param maxResults - Maximum number of results to return
     * @returns Citation results with generated BibTeX entries
     */
    async search(
        context: DocumentContext,
        maxResults: number,
    ): Promise<CitationResult[]> {
        if (context.keyTerms.length === 0) {
            return [];
        }

        // Build a natural query from key terms.
        // Prefer short phrases (2-3 words) and important single words.
        // S2's relevance search works best with natural-sounding queries.
        const phrases = context.keyTerms.filter(t => t.includes(' ')).slice(0, 3);
        const words = context.keyTerms.filter(t => !t.includes(' ') && t.length >= 4).slice(0, 3);
        const queryParts = [...phrases, ...words].slice(0, 5);
        const query = queryParts.join(' ');

        return this.executeSearch(query, maxResults);
    }

    /**
     * Search Semantic Scholar with a single query string.
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
        return this.executeSearch(term, maxResults);
    }

    /**
     * Search using multiple LLM-generated queries in parallel.
     *
     * Each query is run as a separate S2 search. Results are deduplicated
     * by paperId.
     *
     * @param queries      - Array of search query strings from the LLM.
     * @param maxPerQuery  - Maximum results per individual query.
     * @returns Deduplicated citation results from all queries.
     */
    async searchWithQueries(
        queries: string[],
        maxPerQuery: number,
    ): Promise<CitationResult[]> {
        if (queries.length === 0) {
            return [];
        }

        // Execute queries sequentially with 1s delay to respect S2 rate limits.
        // The introductory API key limit is 1 request/second.
        const seen = new Map<string, CitationResult>();

        for (let i = 0; i < queries.length; i++) {
            if (i > 0) {
                await this.sleep(1_000);
            }

            try {
                const results = await this.executeSearch(queries[i], maxPerQuery);
                for (const result of results) {
                    if (!seen.has(result.sourceId)) {
                        seen.set(result.sourceId, result);
                    }
                }
            } catch {
                // Individual query failures are non-fatal
            }
        }

        return Array.from(seen.values());
    }

    /**
     * Get paper recommendations based on positive example papers.
     *
     * Uses the S2 Recommendations API (citation-graph-aware) to find
     * papers conceptually related to the given positive examples.
     *
     * @param positivePaperIds - S2 paper IDs to use as positive examples.
     * @param limit            - Maximum number of recommendations.
     * @returns Citation results from the recommendations API.
     */
    async getRecommendations(
        positivePaperIds: string[],
        limit: number,
    ): Promise<CitationResult[]> {
        if (positivePaperIds.length === 0) {
            return [];
        }

        const log = getLogger();

        try {
            await this.enforceRateLimit();

            const headers: Record<string, string> = {};
            if (this.apiKey) {
                headers['x-api-key'] = this.apiKey;
            }

            log.debug(`[S2] Recommendations request with ${positivePaperIds.length} seed IDs`);

            const response = await axios.post(
                'https://api.semanticscholar.org/recommendations/v1/papers',
                {
                    positivePaperIds,
                    negativePaperIds: [],
                },
                {
                    params: {
                        fields: RECOMMENDATIONS_FIELDS,
                        limit,
                    },
                    headers,
                    timeout: REQUEST_TIMEOUT_MS,
                },
            );

            const papers: S2Paper[] = response.data?.recommendedPapers || [];
            return papers.map((paper) => this.mapToCitationResult(paper));
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const status = error.response?.status;
                const body = error.response?.data;
                log.error(
                    `[S2] Recommendations API error (HTTP ${status}): ${error.message}`
                    + (body ? ` | ${JSON.stringify(body)}` : ''),
                );
            } else {
                log.error(`[S2] Recommendations API error: ${error}`);
            }
            return [];
        }
    }

    /**
     * Compute SPECTER embedding similarity between a hypothetical abstract
     * and a set of candidate papers.
     *
     * Uses the Semantic Scholar SPECTER API to embed the hypothetical
     * abstract, fetches embeddings for candidate papers, and returns
     * a map of paperId -> cosine similarity score.
     *
     * @param hypotheticalAbstract - The LLM-generated hypothetical abstract.
     * @param candidatePaperIds    - Paper IDs to compare against.
     * @returns Map of paperId to cosine similarity (0-1).
     */
    async specterSearch(
        hypotheticalAbstract: string,
        candidatePaperIds: string[],
    ): Promise<Map<string, number>> {
        const similarities = new Map<string, number>();

        if (!hypotheticalAbstract || candidatePaperIds.length === 0) {
            return similarities;
        }

        try {
            // 1. Embed the hypothetical abstract via SPECTER API
            const embedResponse = await axios.post(
                'https://model-apis.semanticscholar.org/specter/v1/invoke',
                [{ paper_id: 'query', title: '', abstract: hypotheticalAbstract }],
                { timeout: 10_000 },
            );

            const queryEmbedding: number[] | undefined = embedResponse.data?.preds?.[0]?.embedding;
            if (!queryEmbedding || queryEmbedding.length === 0) {
                return similarities;
            }

            // 2. Fetch embeddings for candidate papers (batch API)
            await this.enforceRateLimit();
            const batchResponse = await this.client.post(
                '/paper/batch',
                { ids: candidatePaperIds.slice(0, 100) },
                { params: { fields: 'paperId,embedding' } },
            );

            const papers: Array<{ paperId: string; embedding?: { vector: number[] } }> =
                batchResponse.data || [];

            // 3. Compute cosine similarity
            for (const paper of papers) {
                if (paper.embedding?.vector) {
                    const sim = this.cosineSimilarity(queryEmbedding, paper.embedding.vector);
                    similarities.set(paper.paperId, sim);
                }
            }
        } catch {
            // SPECTER failure is non-fatal — return empty map
        }

        return similarities;
    }

    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length || a.length === 0) {
            return 0;
        }

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        const denominator = Math.sqrt(normA) * Math.sqrt(normB);
        return denominator === 0 ? 0 : dotProduct / denominator;
    }

    // ── Rate limiting ───────────────────────────────────────────────────────

    /**
     * Track a new request and delay if approaching the rate limit.
     *
     * This is a client-side best-effort mechanism. The server will still
     * enforce limits, but proactive throttling avoids 429 errors.
     */
    private async enforceRateLimit(): Promise<void> {
        const now = Date.now();

        // Prune timestamps outside the current window
        this.requestTimestamps = this.requestTimestamps.filter(
            (ts) => now - ts < RATE_LIMIT_WINDOW_MS,
        );

        if (this.requestTimestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
            // We have hit the cap. Compute how long until the oldest
            // request falls out of the window.
            const oldestInWindow = this.requestTimestamps[0];
            const waitMs = RATE_LIMIT_WINDOW_MS - (now - oldestInWindow) + 500;
            getLogger().warn(
                `[S2] Rate limit reached. `
                + `Waiting ${Math.round(waitMs / 1000)}s before next request.`,
            );
            await this.sleep(waitMs);
        } else if (
            this.requestTimestamps.length >=
            RATE_LIMIT_MAX_REQUESTS - RATE_LIMIT_WARN_THRESHOLD
        ) {
            getLogger().warn(
                `[S2] Approaching rate limit `
                + `(${this.requestTimestamps.length}/${RATE_LIMIT_MAX_REQUESTS} `
                + `requests in the current window). Adding delay.`,
            );
            await this.sleep(RATE_LIMIT_DELAY_MS);
        }

        this.requestTimestamps.push(Date.now());
    }

    /**
     * Promise-based sleep utility.
     *
     * @param ms - Duration in milliseconds
     */
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // ── API execution ───────────────────────────────────────────────────────

    /**
     * Execute a paper search request against the Semantic Scholar API.
     *
     * @param query - Free-text query string
     * @param limit - Maximum items to request
     * @returns Mapped citation results
     */
    private async executeSearch(
        query: string,
        limit: number,
    ): Promise<CitationResult[]> {
        try {
            await this.enforceRateLimit();

            const response = await this.client.get<S2SearchResponse>(
                '/paper/search',
                {
                    params: {
                        query,
                        limit,
                        fields: SEARCH_FIELDS,
                    },
                },
            );

            if (!response.data?.data) {
                return [];
            }

            return response.data.data.map((paper) =>
                this.mapToCitationResult(paper),
            );
        } catch (error) {
            this.handleError(error, query);
            return [];
        }
    }

    // ── Result mapping ──────────────────────────────────────────────────────

    /**
     * Convert a Semantic Scholar paper object into the extension's
     * CitationResult format, including a generated BibTeX entry.
     *
     * @param paper - Raw API response paper object
     * @returns Normalized citation result
     */
    private mapToCitationResult(paper: S2Paper): CitationResult {
        const authors = this.mapAuthors(paper.authors);
        const year = paper.year ?? null;
        const journal = paper.publicationVenue?.name || '';
        const doi = paper.externalIds?.DOI || '';
        const abstract = paper.abstract || '';
        const title = paper.title || '';
        const bibtexKey = this.generateBibtexKey(authors, year);
        const bibtexType = inferBibtexType(paper.publicationVenue);
        const url = paper.url || paper.openAccessPdf?.url || '';

        return {
            sourceId: paper.paperId,
            source: CitationSource.SemanticScholar,
            title,
            authors,
            year,
            journal,
            abstract,
            doi,
            bibtexKey,
            bibtexEntry: this.generateBibtexEntry(
                bibtexType,
                bibtexKey,
                title,
                authors,
                year,
                journal,
                doi,
                abstract,
            ),
            citationCount: paper.citationCount ?? undefined,
            influentialCitationCount: paper.influentialCitationCount ?? undefined,
            tldr: paper.tldr?.text || undefined,
            itemType: bibtexType === 'inproceedings' ? 'inproceedings' : 'article',
            relevanceScore: 0,
            url: url || undefined,
        };
    }

    /**
     * Map Semantic Scholar author objects to the Author interface.
     *
     * S2 provides a single `name` field per author. We split it into
     * first and last name on a best-effort basis (the last whitespace-
     * delimited token becomes the last name).
     *
     * @param s2Authors - Array of S2 author objects
     * @returns Normalized author list
     */
    private mapAuthors(s2Authors: S2Author[]): Author[] {
        if (!s2Authors || s2Authors.length === 0) {
            return [];
        }

        return s2Authors.map((a) => {
            const trimmed = (a.name || '').trim();
            if (!trimmed) {
                return { name: '' };
            }

            const parts = trimmed.split(/\s+/);
            if (parts.length === 1) {
                return { lastName: parts[0], name: trimmed };
            }

            const lastName = parts[parts.length - 1];
            const firstName = parts.slice(0, -1).join(' ');
            return { firstName, lastName };
        });
    }

    // ── BibTeX generation ───────────────────────────────────────────────────

    /**
     * Generate a BibTeX citation key from author and year information.
     *
     * Format: `LastName2023`. If no author is available, uses "Unknown".
     * If no year is available, the year portion is omitted.
     *
     * @param authors - Parsed author list
     * @param year    - Publication year (may be null)
     * @returns A BibTeX-safe citation key
     */
    private generateBibtexKey(authors: Author[], year: number | null): string {
        let lastName = 'Unknown';

        if (authors.length > 0) {
            const first = authors[0];
            if (first.lastName) {
                lastName = first.lastName;
            } else if (first.name) {
                const parts = first.name.trim().split(/\s+/);
                lastName = parts[parts.length - 1];
            }
        }

        // Remove non-ASCII and non-letter characters
        const sanitized = lastName.replace(/[^a-zA-Z]/g, '');
        const yearStr = year !== null ? String(year) : '';

        return `${sanitized}${yearStr}`;
    }

    /**
     * Generate a complete BibTeX entry for a paper.
     *
     * Handles missing fields gracefully: optional fields are omitted rather
     * than emitted with empty values. Special characters in text fields are
     * escaped for BibTeX compatibility.
     *
     * @param entryType - BibTeX entry type (article, inproceedings, etc.)
     * @param key       - Citation key
     * @param title     - Paper title
     * @param authors   - Author list
     * @param year      - Publication year
     * @param journal   - Journal or venue name
     * @param doi       - DOI string
     * @param abstract  - Paper abstract
     * @returns Formatted BibTeX entry string
     */
    private generateBibtexEntry(
        entryType: string,
        key: string,
        title: string,
        authors: Author[],
        year: number | null,
        journal: string,
        doi: string,
        abstract: string,
    ): string {
        const lines: string[] = [];

        lines.push(`@${entryType}{${key},`);

        if (title) {
            lines.push(`  title = {${this.escapeBibtex(title)}},`);
        }

        if (authors.length > 0) {
            const authorStr = authors
                .map((a) => this.formatBibtexAuthor(a))
                .join(' and ');
            lines.push(`  author = {${authorStr}},`);
        }

        if (year !== null) {
            lines.push(`  year = {${year}},`);
        }

        // Use "journal" for articles, "booktitle" for proceedings
        if (journal) {
            const field = entryType === 'inproceedings' ? 'booktitle' : 'journal';
            lines.push(`  ${field} = {${this.escapeBibtex(journal)}},`);
        }

        if (doi) {
            lines.push(`  doi = {${doi}},`);
        }

        if (abstract) {
            lines.push(`  abstract = {${this.escapeBibtex(abstract)}},`);
        }

        // Close the entry: remove trailing comma from the last field
        const lastLine = lines[lines.length - 1];
        lines[lines.length - 1] = lastLine.replace(/,$/, '');
        lines.push('}');

        return lines.join('\n');
    }

    /**
     * Format a single author in BibTeX "Last, First" notation.
     *
     * @param author - Author object
     * @returns BibTeX-formatted author name
     */
    private formatBibtexAuthor(author: Author): string {
        if (author.lastName && author.firstName) {
            return `${author.lastName}, ${author.firstName}`;
        }
        if (author.lastName) {
            return author.lastName;
        }
        if (author.name) {
            // Attempt to reformat "First Last" as "Last, First"
            const parts = author.name.trim().split(/\s+/);
            if (parts.length > 1) {
                const last = parts[parts.length - 1];
                const first = parts.slice(0, -1).join(' ');
                return `${last}, ${first}`;
            }
            return author.name;
        }
        return '';
    }

    /**
     * Escape special BibTeX characters in a text string.
     *
     * Handles: &, %, #, _, {, }, ~, ^, and the backslash itself.
     * Curly braces that are clearly part of LaTeX commands are left alone
     * by escaping only unmatched braces (a simplification: we escape all
     * for safety since S2 data rarely contains LaTeX).
     *
     * @param text - Raw text to escape
     * @returns BibTeX-safe text
     */
    private escapeBibtex(text: string): string {
        return text
            .replace(/\\/g, '\\textbackslash{}')
            .replace(/&/g, '\\&')
            .replace(/%/g, '\\%')
            .replace(/#/g, '\\#')
            .replace(/_/g, '\\_')
            .replace(/~/g, '\\textasciitilde{}')
            .replace(/\^/g, '\\textasciicircum{}');
    }

    // ── Error handling ──────────────────────────────────────────────────────

    /**
     * Handle and log Semantic Scholar API errors with meaningful messages.
     *
     * @param error - Caught error (typically AxiosError)
     * @param query - The query that triggered the error, for logging context
     */
    private handleError(error: unknown, query: string): void {
        const log = getLogger();

        if (!axios.isAxiosError(error)) {
            log.error(`[S2] Unexpected error for "${query}": ${error}`);
            return;
        }

        const axiosErr = error as AxiosError;

        if (axiosErr.code === 'ECONNABORTED' || axiosErr.code === 'ETIMEDOUT') {
            log.error(`[S2] Connection timed out for query "${query}"`);
            return;
        }

        if (!axiosErr.response) {
            log.error(`[S2] Network error for query "${query}": ${axiosErr.message}`);
            return;
        }

        const status = axiosErr.response.status;

        switch (status) {
            case 429:
                log.error(
                    this.apiKey
                        ? '[S2] Rate limit exceeded (1 req/s with API key). Queries will retry with delays.'
                        : '[S2] Rate limit exceeded. Consider adding an API key in settings.',
                );
                break;
            case 400:
                log.error(`[S2] Bad request for query "${query}". Terms may be too short or malformed.`);
                break;
            case 500:
            case 502:
            case 503:
                log.error(`[S2] Service error (HTTP ${status}). Service may be temporarily unavailable.`);
                break;
            default:
                log.error(`[S2] API error (HTTP ${status}) for query "${query}": ${axiosErr.message}`);
        }
    }
}

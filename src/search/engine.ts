/**
 * Search orchestration engine for the LaTeX Citation Assistant.
 *
 * The {@link SearchEngine} coordinates parallel queries to multiple
 * citation sources (Zotero, Semantic Scholar), collects timing
 * statistics, and funnels the merged results through the
 * {@link ResultRanker} before returning them to the UI layer.
 *
 * When an LLM provider is configured, the engine uses LLM-generated
 * queries, SPECTER embedding search, and LLM re-ranking for
 * dramatically better relevance. Without an LLM, it falls back
 * to the existing NLP-based pipeline.
 *
 * @module search/engine
 */

import {
    CitationResult,
    CitationSource,
    DocumentContext,
    LLMQueryResult,
    SearchRequest,
    SearchResponse,
} from '../types';
import { ZoteroSource } from '../sources/zotero';
import { SemanticScholarSource } from '../sources/semantic-scholar';
import { ResultRanker } from './ranker';
import { getLogger } from '../utils/logger';
import { LLMProviderInterface, QueryGenerator, LLMReranker } from '../llm';

/**
 * Orchestrates citation searches across multiple academic databases.
 *
 * @example
 * ```ts
 * const engine = new SearchEngine(zotero, s2, ranker, llmProvider);
 *
 * const response = await engine.search({
 *     context,
 *     maxResultsPerSource: 20,
 *     sources: [CitationSource.Zotero, CitationSource.SemanticScholar],
 * });
 * console.log(`Found ${response.results.length} results in ${response.totalDurationMs}ms`);
 * ```
 */
export class SearchEngine {
    private zotero: ZoteroSource;
    private semanticScholar: SemanticScholarSource;
    private ranker: ResultRanker;
    private queryGenerator: QueryGenerator | null;
    private llmReranker: LLMReranker | null;

    /**
     * @param zotero          - Zotero source client.
     * @param semanticScholar - Semantic Scholar source client.
     * @param ranker          - Result ranker for scoring and deduplication.
     * @param llmProvider     - Optional LLM provider for enhanced search.
     */
    constructor(
        zotero: ZoteroSource,
        semanticScholar: SemanticScholarSource,
        ranker: ResultRanker,
        llmProvider?: LLMProviderInterface | null,
    ) {
        this.zotero = zotero;
        this.semanticScholar = semanticScholar;
        this.ranker = ranker;

        if (llmProvider) {
            this.queryGenerator = new QueryGenerator(llmProvider);
            this.llmReranker = new LLMReranker(llmProvider);
        } else {
            this.queryGenerator = null;
            this.llmReranker = null;
        }
    }

    /**
     * Execute a multi-source search and return ranked results.
     *
     * Dispatches to the LLM-assisted pipeline when a provider is
     * configured, otherwise falls back to the legacy NLP pipeline.
     *
     * @param request - The search parameters including context, source
     *                  selection, and per-source result limit.
     * @returns A {@link SearchResponse} containing ranked results and
     *          per-source statistics.
     */
    async search(request: SearchRequest): Promise<SearchResponse> {
        if (this.queryGenerator && this.llmReranker) {
            return this.searchWithLLM(request);
        }
        return this.searchLegacy(request);
    }

    /**
     * Search a single source directly, bypassing the multi-source
     * orchestration.
     *
     * This is used by the individual `latex-cite.suggestZotero` and
     * `latex-cite.suggestSemanticScholar` commands where the user
     * explicitly picks one database.
     *
     * @param source     - Which source to query.
     * @param context    - The document context for the query.
     * @param maxResults - Maximum number of results to return.
     * @returns An array of (unranked) citation results from the
     *          requested source.
     * @throws If the source is not configured or the query fails.
     */
    async searchSingleSource(
        source: CitationSource,
        context: DocumentContext,
        maxResults: number,
    ): Promise<CitationResult[]> {
        const log = getLogger();

        switch (source) {
            case CitationSource.Zotero:
                if (!this.zotero.isConfigured()) {
                    throw new Error(
                        'Zotero is not configured. Please set your API key and user ID in settings.',
                    );
                }
                log.info(`Searching Zotero (max ${maxResults})`);
                return this.zotero.search(context, maxResults);

            case CitationSource.SemanticScholar:
                log.info(`Searching Semantic Scholar (max ${maxResults})`);
                return this.semanticScholar.search(context, maxResults);

            default:
                throw new Error(`Unknown citation source: ${source}`);
        }
    }

    // ── LLM-assisted pipeline ───────────────────────────────────────────────

    /**
     * LLM-assisted search pipeline:
     *   1. LLM query generation (sequential, ~1s)
     *   2. Enrich context with LLM-derived key terms
     *   3. Parallel retrieval via LLM queries (S2 + Zotero)
     *   4. Heuristic ranking
     *   5. SPECTER similarity boost
     *   6. LLM re-ranking of top candidates
     */
    private async searchWithLLM(request: SearchRequest): Promise<SearchResponse> {
        const log = getLogger();
        const overallStart = Date.now();
        const { context, maxResultsPerSource, sources } = request;

        log.info('Starting LLM-assisted search pipeline');

        // 1. LLM query generation
        const llmResult = await this.queryGenerator!.generate(context);

        // 2. Enrich context with LLM-derived terms
        const enrichedContext: DocumentContext = {
            ...context,
            keyTerms: llmResult.keyTerms.length > 0 ? llmResult.keyTerms : context.keyTerms,
        };

        // 3. Parallel retrieval using LLM queries
        const allResults: CitationResult[] = [];
        const sourceStats: SearchResponse['sourceStats'] = [];
        const retrievalPromises: Promise<void>[] = [];

        for (const source of sources) {
            if (source === CitationSource.SemanticScholar) {
                retrievalPromises.push(
                    this.retrieveS2WithLLM(llmResult, maxResultsPerSource, allResults, sourceStats),
                );
            } else if (source === CitationSource.Zotero) {
                if (!this.zotero.isConfigured()) {
                    log.warn('Zotero requested but not configured -- skipping');
                    continue;
                }
                retrievalPromises.push(
                    this.retrieveZoteroWithLLM(llmResult, maxResultsPerSource, allResults, sourceStats),
                );
            }
        }

        await Promise.allSettled(retrievalPromises);

        if (allResults.length === 0) {
            log.warn('LLM-assisted retrieval returned no results');
            return { results: [], sourceStats, totalDurationMs: Date.now() - overallStart };
        }

        // 3b. Recommendations from top S2 results (citation-graph-aware)
        await this.retrieveRecommendations(allResults, log);

        // 4. Heuristic ranking
        const ranked = this.ranker.rankResults(allResults, enrichedContext);

        // 5+6. SPECTER boost and LLM re-ranking run in parallel
        const [, reranked] = await Promise.all([
            this.applySpecterBoost(ranked, llmResult),
            this.llmReranker!.rerank(ranked, enrichedContext),
        ]);

        const totalDurationMs = Date.now() - overallStart;
        log.info(
            `LLM-assisted search complete: ${reranked.length} results in ${totalDurationMs}ms`,
        );

        return {
            results: reranked,
            sourceStats,
            totalDurationMs,
        };
    }

    private async retrieveS2WithLLM(
        llmResult: LLMQueryResult,
        maxResults: number,
        allResults: CitationResult[],
        sourceStats: SearchResponse['sourceStats'],
    ): Promise<void> {
        const start = Date.now();
        try {
            // Include hypothetical abstract (truncated) as an additional
            // natural-language query to catch papers keyword queries miss.
            const queries = [...llmResult.searchQueries];
            if (llmResult.hypotheticalAbstract) {
                queries.push(llmResult.hypotheticalAbstract.slice(0, 200));
            }

            const results = await this.semanticScholar.searchWithQueries(
                queries,
                Math.ceil(maxResults / queries.length),
            );
            allResults.push(...results);
            sourceStats.push({
                source: CitationSource.SemanticScholar,
                totalFound: results.length,
                returned: results.length,
                queryTerms: llmResult.searchQueries,
                durationMs: Date.now() - start,
                llmAssisted: true,
            });
            getLogger().info(
                `S2 (LLM): ${results.length} results in ${Date.now() - start}ms`,
            );
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            getLogger().error(`S2 (LLM) search failed: ${msg}`);
            sourceStats.push({
                source: CitationSource.SemanticScholar,
                totalFound: 0,
                returned: 0,
                queryTerms: llmResult.searchQueries,
                durationMs: Date.now() - start,
                llmAssisted: true,
            });
        }
    }

    private async retrieveZoteroWithLLM(
        llmResult: LLMQueryResult,
        maxResults: number,
        allResults: CitationResult[],
        sourceStats: SearchResponse['sourceStats'],
    ): Promise<void> {
        const start = Date.now();
        try {
            // Use both LLM queries and key terms for Zotero
            const queries = [
                ...llmResult.searchQueries.slice(0, 3),
                ...llmResult.keyTerms.filter(t => t.length >= 4).slice(0, 2),
            ];
            const results = await this.zotero.searchWithQueries(queries, maxResults);
            allResults.push(...results);
            sourceStats.push({
                source: CitationSource.Zotero,
                totalFound: results.length,
                returned: results.length,
                queryTerms: queries,
                durationMs: Date.now() - start,
                llmAssisted: true,
            });
            getLogger().info(
                `Zotero (LLM): ${results.length} results in ${Date.now() - start}ms`,
            );
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            getLogger().error(`Zotero (LLM) search failed: ${msg}`);
            sourceStats.push({
                source: CitationSource.Zotero,
                totalFound: 0,
                returned: 0,
                queryTerms: llmResult.searchQueries,
                durationMs: Date.now() - start,
                llmAssisted: true,
            });
        }
    }

    /**
     * Use the S2 Recommendations API to find citation-graph-aware
     * papers related to the top keyword results.
     *
     * Takes the top 5 S2 results by citation count as positive examples
     * and fetches recommendations. New papers are appended (deduplicated).
     */
    private async retrieveRecommendations(
        allResults: CitationResult[],
        log: ReturnType<typeof getLogger>,
    ): Promise<void> {
        const s2Results = allResults
            .filter(r => r.source === CitationSource.SemanticScholar)
            .sort((a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0))
            .slice(0, 5);

        if (s2Results.length === 0) {
            return;
        }

        try {
            const start = Date.now();
            const seedIds = s2Results.map(r => r.sourceId);
            const recommendations = await this.semanticScholar.getRecommendations(seedIds, 10);

            // Deduplicate against existing results
            const existingIds = new Set(allResults.map(r => r.sourceId));
            let added = 0;
            for (const rec of recommendations) {
                if (!existingIds.has(rec.sourceId)) {
                    allResults.push(rec);
                    existingIds.add(rec.sourceId);
                    added++;
                }
            }

            log.info(
                `Recommendations: ${added} new papers added from ${recommendations.length} candidates `
                + `in ${Date.now() - start}ms`,
            );
        } catch {
            log.debug('Recommendations API skipped (unavailable)');
        }
    }

    /**
     * Apply SPECTER similarity boost to Semantic Scholar results.
     *
     * Papers with high embedding similarity to the hypothetical abstract
     * receive up to 15 bonus points on their relevance score.
     */
    private async applySpecterBoost(
        results: CitationResult[],
        llmResult: LLMQueryResult,
    ): Promise<void> {
        if (!llmResult.hypotheticalAbstract) {
            return;
        }

        const log = getLogger();
        const s2Results = results.filter(r => r.source === CitationSource.SemanticScholar);
        if (s2Results.length === 0) {
            return;
        }

        try {
            const paperIds = s2Results.map(r => r.sourceId);
            const similarities = await this.semanticScholar.specterSearch(
                llmResult.hypotheticalAbstract,
                paperIds,
            );

            if (similarities.size === 0) {
                return;
            }

            for (const result of results) {
                const sim = similarities.get(result.sourceId);
                if (sim !== undefined && sim > 0) {
                    // Map similarity (typically 0.3-0.9) to 0-15 bonus points
                    const bonus = Math.round(Math.min(15, sim * 15));
                    result.relevanceScore = Math.min(100, result.relevanceScore + bonus);
                }
            }

            log.info(`SPECTER boost applied to ${similarities.size} papers`);
        } catch {
            log.debug('SPECTER similarity boost skipped (API unavailable)');
        }
    }

    // ── Legacy NLP pipeline ─────────────────────────────────────────────────

    /**
     * Legacy search using the NLP-based key term extraction.
     * This is the original search() method preserved as a fallback.
     */
    private async searchLegacy(request: SearchRequest): Promise<SearchResponse> {
        const log = getLogger();
        const overallStart = Date.now();
        const { context, maxResultsPerSource, sources } = request;

        log.info(
            `Starting search across ${sources.length} source(s) ` +
            `[terms: ${context.keyTerms.slice(0, 5).join(', ')}]`,
        );

        // Build the list of source queries to execute.
        const queries: {
            source: CitationSource;
            promise: Promise<CitationResult[]>;
            startTime: number;
        }[] = [];

        for (const source of sources) {
            if (source === CitationSource.Zotero) {
                if (!this.zotero.isConfigured()) {
                    log.warn('Zotero requested but not configured -- skipping');
                    continue;
                }
                const start = Date.now();
                queries.push({
                    source,
                    promise: this.zotero.search(context, maxResultsPerSource),
                    startTime: start,
                });
            } else if (source === CitationSource.SemanticScholar) {
                const start = Date.now();
                queries.push({
                    source,
                    promise: this.semanticScholar.search(context, maxResultsPerSource),
                    startTime: start,
                });
            }
        }

        // Execute all queries in parallel.
        const settlements = await Promise.allSettled(
            queries.map((q) => q.promise),
        );

        // Collect results and build per-source statistics.
        const allResults: CitationResult[] = [];
        const sourceStats: SearchResponse['sourceStats'] = [];

        for (let i = 0; i < settlements.length; i++) {
            const settlement = settlements[i];
            const query = queries[i];
            const durationMs = Date.now() - query.startTime;

            if (settlement.status === 'fulfilled') {
                const results = settlement.value;
                allResults.push(...results);
                sourceStats.push({
                    source: query.source,
                    totalFound: results.length,
                    returned: results.length,
                    queryTerms: context.keyTerms,
                    durationMs,
                });
                log.info(
                    `${query.source}: ${results.length} results in ${durationMs}ms`,
                );
            } else {
                const reason =
                    settlement.reason instanceof Error
                        ? settlement.reason.message
                        : String(settlement.reason);
                log.error(`${query.source} search failed: ${reason}`);
                sourceStats.push({
                    source: query.source,
                    totalFound: 0,
                    returned: 0,
                    queryTerms: context.keyTerms,
                    durationMs,
                });
            }
        }

        // Rank and return.
        const ranked = this.ranker.rankResults(allResults, context);
        const totalDurationMs = Date.now() - overallStart;

        log.info(
            `Search complete: ${ranked.length} results (ranked) in ${totalDurationMs}ms`,
        );

        return {
            results: ranked,
            sourceStats,
            totalDurationMs,
        };
    }
}

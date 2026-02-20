/**
 * LLM-powered re-ranker for the LaTeX Citation Assistant.
 *
 * Takes the top candidates from heuristic ranking and uses an LLM to
 * score them based on contextual relevance, attaching relevance
 * explanations to each result.
 */

import { CitationResult, DocumentContext, LLMRankedItem } from '../types';
import { LLMProviderInterface } from './provider';
import { getLogger } from '../utils/logger';

const SYSTEM_PROMPT = `Score each candidate paper's relevance for citation in the given writing context. Return JSON array only, no explanation.`;

/** Maximum candidates to send to the LLM for re-ranking. */
const MAX_CANDIDATES = 20;

/** Maximum abstract length per candidate to keep prompt size manageable. */
const MAX_ABSTRACT_CHARS = 200;

/**
 * Re-ranks citation results using LLM-based relevance scoring.
 */
export class LLMReranker {
    private provider: LLMProviderInterface;

    constructor(provider: LLMProviderInterface) {
        this.provider = provider;
    }

    /**
     * Re-rank the top candidates using the LLM.
     *
     * On failure, returns results with their heuristic scores unchanged.
     */
    async rerank(
        results: CitationResult[],
        context: DocumentContext,
    ): Promise<CitationResult[]> {
        const log = getLogger();

        if (results.length === 0) {
            return results;
        }

        // Only re-rank the top N candidates
        const candidates = results.slice(0, MAX_CANDIDATES);
        const rest = results.slice(MAX_CANDIDATES);

        try {
            log.info(`LLM re-ranking top ${candidates.length} candidates...`);

            const userPrompt = this.buildUserPrompt(candidates, context);
            const response = await this.provider.complete(
                SYSTEM_PROMPT,
                userPrompt,
                {
                    temperature: 0.1,
                    maxTokens: 2000,
                    timeoutMs: 25_000,
                },
            );

            const rankings = this.parseResponse(response);
            const reranked = this.applyRankings(candidates, rankings);

            log.info(`LLM re-ranking complete: ${rankings.length} papers scored`);

            // Sort re-ranked by score descending, append the rest
            reranked.sort((a, b) => b.relevanceScore - a.relevanceScore);
            return [...reranked, ...rest];
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            log.warn(`LLM re-ranking failed: ${msg}. Keeping heuristic scores.`);
            return results;
        }
    }

    private buildUserPrompt(
        candidates: CitationResult[],
        context: DocumentContext,
    ): string {
        const parts: string[] = [];

        parts.push('Writing context:');
        if (context.documentTitle) {
            parts.push(`Document: ${context.documentTitle}`);
        }
        if (context.section && context.section !== 'unknown') {
            parts.push(`Section: ${context.section}`);
        }
        parts.push(`Paragraph: ${context.currentParagraph}`);
        parts.push('');

        parts.push('Candidate papers:');
        for (const c of candidates) {
            // Prefer TLDR (concise, model-generated) over truncated abstract
            let summary: string;
            if (c.tldr) {
                summary = c.tldr;
            } else if (c.abstract) {
                summary = c.abstract.slice(0, MAX_ABSTRACT_CHARS)
                    + (c.abstract.length > MAX_ABSTRACT_CHARS ? '...' : '');
            } else {
                summary = '(no abstract)';
            }
            const yearStr = c.year !== null ? ` (${c.year})` : '';
            parts.push(`- ID: ${c.sourceId} | "${c.title}"${yearStr} | ${summary}`);
        }

        parts.push('');
        parts.push(`Return JSON: [{"sourceId": "...", "score": 1-10, "reason": "5-10 word explanation"}]
Scoring: 9-10=directly supports a claim, 7-8=highly relevant, 5-6=tangential, 3-4=same field only, 1-2=irrelevant.`);

        return parts.join('\n');
    }

    private parseResponse(raw: string): LLMRankedItem[] {
        let cleaned = raw.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        }

        const parsed = JSON.parse(cleaned);

        if (!Array.isArray(parsed)) {
            throw new Error('LLM re-ranker did not return an array');
        }

        return parsed
            .filter((item: unknown) => {
                if (typeof item !== 'object' || item === null) { return false; }
                const obj = item as Record<string, unknown>;
                return typeof obj.sourceId === 'string' && typeof obj.score === 'number';
            })
            .map((item: Record<string, unknown>) => ({
                sourceId: item.sourceId as string,
                score: Math.min(10, Math.max(1, item.score as number)),
                reason: typeof item.reason === 'string' ? item.reason : '',
            }));
    }

    private applyRankings(
        candidates: CitationResult[],
        rankings: LLMRankedItem[],
    ): CitationResult[] {
        const rankMap = new Map<string, LLMRankedItem>();
        for (const r of rankings) {
            rankMap.set(r.sourceId, r);
        }

        return candidates.map((result) => {
            const ranking = rankMap.get(result.sourceId);
            if (ranking) {
                return {
                    ...result,
                    // Map LLM score (1-10) to relevanceScore (0-100)
                    relevanceScore: Math.round((ranking.score / 10) * 100),
                    relevanceReason: ranking.reason || undefined,
                };
            }
            return result;
        });
    }
}

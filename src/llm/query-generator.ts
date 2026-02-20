/**
 * LLM-powered query generator for the LaTeX Citation Assistant.
 *
 * Uses an LLM to analyze the writing context and produce targeted
 * search queries, a hypothetical abstract for embedding search,
 * and a claim analysis for identifying citation needs.
 */

import { DocumentContext, LLMQueryResult } from '../types';
import { LLMProviderInterface } from './provider';
import { getLogger } from '../utils/logger';

const SYSTEM_PROMPT = `You are an academic citation assistant. Analyze a paragraph from a scientific manuscript and generate search queries to find relevant papers.

CRITICAL query format rules:
- Each query must be 2-4 words (e.g., "canonical neural computations", "cortical microcircuits")
- Use established academic terminology, not paraphrases
- Prefer noun phrases that match how paper titles and abstracts are written
- Do NOT combine unrelated concepts in one query

Respond with valid JSON only. No markdown fences, no explanation.`;

/**
 * Generates LLM-powered search queries from document context.
 */
export class QueryGenerator {
    private provider: LLMProviderInterface;

    constructor(provider: LLMProviderInterface) {
        this.provider = provider;
    }

    /**
     * Generate search queries and a hypothetical abstract from context.
     *
     * On LLM failure, returns a fallback result built from the NLP key terms.
     */
    async generate(context: DocumentContext): Promise<LLMQueryResult> {
        const log = getLogger();

        try {
            log.info('LLM query generation starting...');
            const userPrompt = this.buildUserPrompt(context);

            const response = await this.provider.complete(
                SYSTEM_PROMPT,
                userPrompt,
                {
                    temperature: 0.3,
                    maxTokens: 600,
                    timeoutMs: 12_000,
                },
            );

            const result = this.parseResponse(response);
            log.info(`LLM generated ${result.searchQueries.length} queries, ${result.keyTerms.length} key terms`);
            log.debug(`LLM queries: ${result.searchQueries.join(' | ')}`);
            return result;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            log.warn(`LLM query generation failed: ${msg}. Falling back to NLP terms.`);
            return this.buildFallback(context);
        }
    }

    private buildUserPrompt(context: DocumentContext): string {
        const parts: string[] = [];

        if (context.documentTitle) {
            parts.push(`Document title: ${context.documentTitle}`);
        }
        if (context.section && context.section !== 'unknown') {
            parts.push(`Current section: ${context.section}`);
        }
        if (context.documentType && context.documentType !== 'unknown') {
            parts.push(`Document type: ${context.documentType}`);
        }

        parts.push(`\nCurrent paragraph:\n${context.currentParagraph}`);

        if (context.contextText && context.contextText !== context.currentParagraph) {
            parts.push(`\nContext sentences:\n${context.contextText}`);
        }

        if (context.existingCitations.length > 0) {
            parts.push(`\nAlready cited: ${context.existingCitations.slice(0, 20).join(', ')}`);
        }

        parts.push(`\nGenerate a JSON object with these fields:
- "searchQueries": array of 4-6 search queries (each MUST be 2-4 words). These go to Semantic Scholar's paper search. Use precise academic terms that appear in paper titles. Good: "synaptic plasticity STDP", "cortical microcircuits", "neural degeneracy". Bad: "microcircuit composition regional specialization brain" (too long).
- "hypotheticalAbstract": a ~80 word hypothetical abstract of an ideal paper to cite here.
- "keyTerms": array of 5-8 technical terms or short phrases from the context.`);

        return parts.join('\n');
    }

    private parseResponse(raw: string): LLMQueryResult {
        // Strip markdown code fences if present
        let cleaned = raw.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        }

        const parsed = JSON.parse(cleaned);

        // Validate and provide defaults
        const result: LLMQueryResult = {
            searchQueries: Array.isArray(parsed.searchQueries) ? parsed.searchQueries.filter((q: unknown) => typeof q === 'string' && q.length > 0) : [],
            hypotheticalAbstract: typeof parsed.hypotheticalAbstract === 'string' ? parsed.hypotheticalAbstract : '',
            keyTerms: Array.isArray(parsed.keyTerms) ? parsed.keyTerms.filter((t: unknown) => typeof t === 'string' && t.length > 0) : [],
            claimAnalysis: Array.isArray(parsed.claimAnalysis) ? parsed.claimAnalysis.filter((c: unknown) => {
                if (typeof c !== 'object' || c === null) { return false; }
                const obj = c as Record<string, unknown>;
                return typeof obj.claim === 'string';
            }).map((c: Record<string, unknown>) => ({
                claim: c.claim as string,
                sourceType: (c.sourceType as string) || 'empirical',
                specificity: (c.specificity as string) || 'medium',
            })) : [],
        };

        if (result.searchQueries.length === 0) {
            throw new Error('LLM returned no search queries');
        }

        return result;
    }

    private buildFallback(context: DocumentContext): LLMQueryResult {
        // Build queries from existing NLP key terms
        const phrases = context.keyTerms.filter(t => t.includes(' ')).slice(0, 3);
        const words = context.keyTerms.filter(t => !t.includes(' ') && t.length >= 4).slice(0, 3);
        const queries = [...phrases, ...words].slice(0, 5);

        // If we have at least two terms, also add a combined query
        if (queries.length === 0 && context.keyTerms.length > 0) {
            queries.push(context.keyTerms.slice(0, 3).join(' '));
        }

        return {
            searchQueries: queries.length > 0 ? queries : [context.keyTerms.join(' ')],
            hypotheticalAbstract: '',
            keyTerms: context.keyTerms,
            claimAnalysis: [],
        };
    }
}

/**
 * Citation result ranking algorithm for the LaTeX Citation Assistant.
 *
 * Scores each {@link CitationResult} on a 0--100 scale using a weighted
 * combination of text relevance, section alignment, citation count,
 * recency, source provenance, and deduplication heuristics. The ranker
 * is the core component that turns a flat list of database hits into a
 * prioritised list of genuinely useful citation suggestions.
 *
 * @module search/ranker
 */

import {
    CitationResult,
    CitationSource,
    DocumentContext,
} from '../types';

// ─── Scoring weights ────────────────────────────────────────────────────────

/** Maximum points awarded for title relevance. */
const TITLE_MAX = 30;
/** Maximum points awarded for abstract relevance. */
const ABSTRACT_MAX = 20;
/** Maximum points for section alignment. */
const SECTION_MAX = 10;
/** Maximum points for citation count (log-scale). */
const CITATION_COUNT_MAX = 15;
/** Maximum points for recency. */
const RECENCY_MAX = 10;
/** Flat bonus for results sourced from the user's Zotero library. */
const ZOTERO_BONUS = 5;
/** Penalty subtracted when a paper is already cited in the document. */
const ALREADY_CITED_PENALTY = 50;

// ─── Section keyword maps ───────────────────────────────────────────────────

/** Title keywords that signal relevance in specific document sections. */
const SECTION_KEYWORDS: Record<string, string[]> = {
    introduction: [
        'review', 'survey', 'overview', 'foundational', 'seminal',
        'comprehensive', 'perspective', 'history', 'background',
    ],
    methods: [
        'method', 'algorithm', 'model', 'framework', 'approach',
        'technique', 'implementation', 'architecture', 'pipeline',
    ],
    results: [
        'performance', 'comparison', 'benchmark', 'evaluation',
        'experiment', 'analysis', 'accuracy', 'improvement',
    ],
    discussion: [
        'implication', 'limitation', 'future', 'challenge',
        'outlook', 'prospect', 'direction', 'open question',
    ],
};

/**
 * Scores and ranks citation results against the document context.
 *
 * Usage is straightforward: construct the ranker once and call
 * {@link rankResults} whenever a new batch of results arrives.
 *
 * @example
 * ```ts
 * const ranker = new ResultRanker();
 * const ranked = ranker.rankResults(mergedResults, context);
 * // ranked[0] is the best suggestion
 * ```
 */
export class ResultRanker {
    /**
     * Score, deduplicate, and sort citation results.
     *
     * The algorithm proceeds in three passes:
     * 1. **Deduplication** -- papers appearing in both Zotero and Semantic
     *    Scholar (matched by DOI or fuzzy title) are merged, keeping the
     *    Zotero entry but inheriting the S2 citation count.
     * 2. **Scoring** -- each remaining result receives points from seven
     *    independent sub-scores (title, abstract, section, citation count,
     *    recency, source bonus, already-cited penalty).
     * 3. **Normalization** -- raw scores are linearly rescaled so that the
     *    best result maps to 100 and the worst to 0 (unless all scores are
     *    equal, in which case every result receives 50).
     *
     * @param results - Unranked results from one or more sources.
     * @param context - The document context extracted at the cursor.
     * @returns A new array sorted by descending `relevanceScore`.
     */
    rankResults(
        results: CitationResult[],
        context: DocumentContext,
    ): CitationResult[] {
        if (results.length === 0) {
            return [];
        }

        // --- 1. Deduplicate across sources ---
        const deduped = this.deduplicateResults(results);

        // --- 2. Score each result ---
        const scored = deduped.map((result) => {
            const raw = this.computeRawScore(result, context);
            return { ...result, relevanceScore: raw };
        });

        // --- 3. Normalize to 0-100 ---
        const rawScores = scored.map((r) => r.relevanceScore);
        const minScore = Math.min(...rawScores);
        const maxScore = Math.max(...rawScores);

        const normalized = scored.map((r) => {
            let normalizedScore: number;
            if (maxScore === minScore) {
                normalizedScore = 50;
            } else {
                normalizedScore = Math.round(
                    ((r.relevanceScore - minScore) / (maxScore - minScore)) * 100,
                );
            }
            return { ...r, relevanceScore: normalizedScore };
        });

        // --- 4. Sort descending ---
        normalized.sort((a, b) => b.relevanceScore - a.relevanceScore);
        return normalized;
    }

    // ─── Private helpers ────────────────────────────────────────────────────

    /**
     * Compute the raw (unnormalized) score for a single result.
     *
     * @param result  - The citation result to score.
     * @param context - The document context.
     * @returns A numeric score (may be negative due to the cited penalty).
     */
    private computeRawScore(
        result: CitationResult,
        context: DocumentContext,
    ): number {
        let score = 0;
        const keyTerms = context.keyTerms;

        score += this.scoreTitleRelevance(result.title, keyTerms);
        score += this.scoreAbstractRelevance(result.abstract, keyTerms);
        score += this.scoreSectionAlignment(result, context.section);
        score += this.scoreCitationCount(result);
        score += this.scoreRecency(result.year);
        score += this.scoreSourceBonus(result.source);
        score += this.scoreAlreadyCited(result.bibtexKey, context);

        return score;
    }

    /**
     * Title relevance: 0--30 points.
     *
     * Each key term that appears (case-insensitive) anywhere in the title
     * contributes equally. If the full context text (multi-word phrase)
     * appears verbatim in the title, a 5-point bonus is added.
     */
    private scoreTitleRelevance(title: string, keyTerms: string[]): number {
        if (!title || keyTerms.length === 0) {
            return 0;
        }

        const titleLower = title.toLowerCase();
        let matches = 0;

        for (const term of keyTerms) {
            if (titleLower.includes(term.toLowerCase())) {
                matches++;
            }
        }

        let score = (matches / keyTerms.length) * TITLE_MAX;

        // Bonus for exact multi-word phrase match (use the first three terms
        // joined as a phrase proxy).
        if (keyTerms.length >= 2) {
            const phrase = keyTerms.slice(0, 3).join(' ').toLowerCase();
            if (titleLower.includes(phrase)) {
                score += 5;
            }
        }

        return Math.min(TITLE_MAX, score);
    }

    /**
     * Abstract relevance: 0--20 points.
     *
     * Same term-matching approach as title relevance but against the
     * abstract text.
     */
    private scoreAbstractRelevance(
        abstract: string,
        keyTerms: string[],
    ): number {
        if (!abstract || keyTerms.length === 0) {
            return 0;
        }

        const abstractLower = abstract.toLowerCase();
        let matches = 0;

        for (const term of keyTerms) {
            if (abstractLower.includes(term.toLowerCase())) {
                matches++;
            }
        }

        return (matches / keyTerms.length) * ABSTRACT_MAX;
    }

    /**
     * Section alignment: 0--10 points.
     *
     * Boosts papers whose titles contain keywords typically associated
     * with the current section of the document. For introduction sections
     * an additional boost is given to highly-cited (foundational) works.
     */
    private scoreSectionAlignment(
        result: CitationResult,
        section: string,
    ): number {
        const sectionLower = section.toLowerCase();
        const keywords = SECTION_KEYWORDS[sectionLower];
        if (!keywords) {
            return 0;
        }

        const titleLower = result.title.toLowerCase();
        let score = 0;

        for (const kw of keywords) {
            if (titleLower.includes(kw)) {
                score += SECTION_MAX / 2;
                break; // one match suffices for a title keyword hit
            }
        }

        // Introduction bonus for highly-cited foundational works.
        if (
            sectionLower === 'introduction' &&
            result.citationCount !== undefined &&
            result.citationCount > 500
        ) {
            score += SECTION_MAX / 2;
        }

        return Math.min(SECTION_MAX, score);
    }

    /**
     * Citation count: 0--15 points (Semantic Scholar results only).
     *
     * Uses a logarithmic scale: `min(15, log10(citationCount + 1) * 5)`.
     */
    private scoreCitationCount(result: CitationResult): number {
        if (result.citationCount === undefined || result.citationCount === null) {
            return 0;
        }
        return Math.min(
            CITATION_COUNT_MAX,
            Math.log10(result.citationCount + 1) * 5,
        );
    }

    /**
     * Recency: 0--10 points.
     *
     * | Age         | Points |
     * |-------------|--------|
     * | 0--2 years  | 10     |
     * | 3--5 years  | 7      |
     * | 6--10 years | 4      |
     * | > 10 years  | 1      |
     */
    private scoreRecency(year: number | null): number {
        if (year === null || year === undefined) {
            return 0;
        }

        const currentYear = new Date().getFullYear();
        const age = currentYear - year;

        if (age <= 2) {
            return RECENCY_MAX; // 10
        }
        if (age <= 5) {
            return 7;
        }
        if (age <= 10) {
            return 4;
        }
        return 1;
    }

    /**
     * Source bonus: +5 points for Zotero results.
     *
     * Papers already in the user's personal library are inherently more
     * likely to be relevant because the user explicitly chose to save them.
     */
    private scoreSourceBonus(source: CitationSource): number {
        return source === CitationSource.Zotero ? ZOTERO_BONUS : 0;
    }

    /**
     * Already-cited penalty: -50 points.
     *
     * If the bibtexKey is found in `context.existingCitations`, the paper
     * is almost certainly not what the user wants suggested again.
     */
    private scoreAlreadyCited(
        bibtexKey: string,
        context: DocumentContext,
    ): number {
        if (!bibtexKey || !context.existingCitations) {
            return 0;
        }
        return context.existingCitations.includes(bibtexKey)
            ? -ALREADY_CITED_PENALTY
            : 0;
    }

    // ─── Deduplication ──────────────────────────────────────────────────────

    /**
     * Merge duplicates that appear in both Zotero and Semantic Scholar.
     *
     * Matching is done first by DOI (exact, case-insensitive) and then by
     * title similarity (Dice coefficient on bigrams, threshold 0.85).
     * When a match is found the Zotero version is kept but the Semantic
     * Scholar citation count is copied over so the ranker can use it.
     *
     * @param results - The raw, possibly-duplicate result list.
     * @returns A new array with duplicates removed.
     */
    private deduplicateResults(results: CitationResult[]): CitationResult[] {
        const zoteroResults = results.filter(
            (r) => r.source === CitationSource.Zotero,
        );
        const s2Results = results.filter(
            (r) => r.source === CitationSource.SemanticScholar,
        );

        // Track which S2 results have been merged into a Zotero entry.
        const mergedS2Indices = new Set<number>();

        const merged = zoteroResults.map((zr) => {
            const copy = { ...zr };

            for (let i = 0; i < s2Results.length; i++) {
                if (mergedS2Indices.has(i)) {
                    continue;
                }

                const s2 = s2Results[i];

                const doiMatch =
                    zr.doi &&
                    s2.doi &&
                    zr.doi.toLowerCase() === s2.doi.toLowerCase();

                const titleMatch =
                    !doiMatch &&
                    this.titleSimilarity(zr.title, s2.title) >= 0.85;

                if (doiMatch || titleMatch) {
                    // Inherit S2 citation count into the Zotero result.
                    if (s2.citationCount !== undefined) {
                        copy.citationCount = s2.citationCount;
                    }
                    mergedS2Indices.add(i);
                    break;
                }
            }

            return copy;
        });

        // Append un-merged S2 results.
        for (let i = 0; i < s2Results.length; i++) {
            if (!mergedS2Indices.has(i)) {
                merged.push(s2Results[i]);
            }
        }

        return merged;
    }

    /**
     * Compute the Dice coefficient between two titles using character
     * bigrams.
     *
     * The Dice coefficient is defined as:
     *   2 * |intersection| / (|bigrams_a| + |bigrams_b|)
     *
     * Titles are lowercased and stripped of non-alphanumeric characters
     * before bigram extraction.
     *
     * @param a - First title.
     * @param b - Second title.
     * @returns A similarity score in [0, 1].
     */
    private titleSimilarity(a: string, b: string): number {
        const bigramsOf = (s: string): Set<string> => {
            const clean = s.toLowerCase().replace(/[^a-z0-9 ]/g, '');
            const bigrams = new Set<string>();
            for (let i = 0; i < clean.length - 1; i++) {
                bigrams.add(clean.substring(i, i + 2));
            }
            return bigrams;
        };

        const ba = bigramsOf(a);
        const bb = bigramsOf(b);

        if (ba.size === 0 && bb.size === 0) {
            return 1;
        }
        if (ba.size === 0 || bb.size === 0) {
            return 0;
        }

        let intersection = 0;
        for (const bigram of ba) {
            if (bb.has(bigram)) {
                intersection++;
            }
        }

        return (2 * intersection) / (ba.size + bb.size);
    }
}

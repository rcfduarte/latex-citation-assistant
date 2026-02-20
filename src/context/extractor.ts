/**
 * Context extraction from LaTeX documents for citation search.
 *
 * This module analyzes the LaTeX source around the cursor position to build a
 * {@link DocumentContext} that drives citation search queries. The pipeline:
 *
 *   1. Extract raw text near the cursor, stripping LaTeX markup.
 *   2. Identify the current section (introduction, methods, etc.).
 *   3. Score and rank key terms using lightweight NLP heuristics.
 *   4. Collect existing citation keys for deduplication.
 *   5. Detect the document class for potential future use.
 *
 * Design rationale: No ML models or external NLP libraries are used. The term
 * extraction relies on frequency, capitalization, acronym detection, n-gram
 * assembly, and section-aware boosting -- sufficient for generating effective
 * academic search queries while keeping the extension lightweight and fast.
 */

import { DocumentContext, ScoredTerm } from '../types';
import { STOPWORDS, LATEX_COMMANDS } from './stopwords';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Maximum characters to look back from the cursor for context extraction. */
const MAX_LOOKBACK_CHARS = 2000;

/** Maximum number of key terms to return. */
const MAX_KEY_TERMS = 12;

/** Minimum number of key terms to return (if available). */
const MIN_KEY_TERMS = 8;

/**
 * Abbreviations that end with a period but do not terminate a sentence.
 * Used to avoid false sentence splits on "e.g.", "Fig. 3", etc.
 */
const ABBREVIATIONS: Set<string> = new Set([
    'e.g', 'i.e', 'et al', 'etc', 'vs', 'fig', 'figs',
    'eq', 'eqs', 'ref', 'refs', 'sec', 'secs',
    'vol', 'no', 'pp', 'ed', 'eds', 'ch',
    'dr', 'prof', 'mr', 'mrs', 'ms',
    'dept', 'univ', 'inst',
    'approx', 'ca', 'cf',
]);

/**
 * Section-specific term boosts. When the cursor is inside one of these
 * sections, terms matching the listed words receive a small score bonus.
 * This helps surface section-relevant citations without filtering anything out.
 */
const SECTION_BOOSTS: Record<string, Set<string>> = {
    introduction: new Set([
        'overview', 'motivation', 'background', 'context', 'review',
        'fundamental', 'challenge', 'problem', 'framework', 'approach',
    ]),
    methods: new Set([
        'algorithm', 'model', 'parameter', 'analysis', 'simulation',
        'implementation', 'protocol', 'procedure', 'technique', 'method',
        'architecture', 'network', 'equation', 'optimization', 'training',
    ]),
    results: new Set([
        'significant', 'performance', 'accuracy', 'error', 'improvement',
        'comparison', 'baseline', 'measure', 'observed', 'effect',
        'increase', 'decrease', 'correlation', 'response', 'activity',
    ]),
    discussion: new Set([
        'implication', 'limitation', 'future', 'interpretation', 'comparison',
        'mechanism', 'hypothesis', 'consistent', 'suggest', 'predict',
        'extend', 'contrast', 'support', 'explain', 'perspective',
    ]),
    conclusion: new Set([
        'summary', 'contribution', 'finding', 'future', 'direction',
        'outlook', 'prospect', 'implication', 'significance',
    ]),
};

// ─── ContextExtractor ───────────────────────────────────────────────────────

/**
 * Extracts structured context from a LaTeX document at the cursor position.
 *
 * Usage:
 * ```typescript
 * const extractor = new ContextExtractor();
 * const ctx = extractor.extractContext(documentText, cursorOffset, 2);
 * // ctx.keyTerms -> ["synaptic plasticity", "STDP", "learning rule", ...]
 * ```
 */
export class ContextExtractor {

    /**
     * Build a complete {@link DocumentContext} from the document text and
     * cursor position.
     *
     * @param text - Full text content of the LaTeX document.
     * @param cursorOffset - Character offset of the cursor within `text`.
     * @param numSentences - Number of preceding sentences to include as context
     *   (typically 1-3; the extension default is 2).
     * @returns A populated {@link DocumentContext} ready for search query generation.
     */
    public extractContext(
        text: string,
        cursorOffset: number,
        numSentences: number,
    ): DocumentContext {
        const contextText = this.extractContextText(text, cursorOffset, numSentences);
        const section = this.identifySection(text, cursorOffset);
        const keyTerms = this.extractKeyTerms(contextText, section);
        const existingCitations = this.findExistingCitations(text);
        const documentType = this.identifyDocumentType(text);
        const currentParagraph = this.extractCurrentParagraph(text, cursorOffset);
        const documentTitle = this.extractDocumentTitle(text);
        const documentAbstract = this.extractDocumentAbstract(text);

        return {
            section,
            keyTerms,
            contextText,
            currentParagraph,
            existingCitations,
            documentType,
            documentTitle,
            documentAbstract,
        };
    }

    // ─── Context Text Extraction ────────────────────────────────────────

    /**
     * Extract and clean the raw text immediately before the cursor.
     *
     * Steps:
     *   1. Slice up to {@link MAX_LOOKBACK_CHARS} characters before cursor.
     *   2. Strip LaTeX commands, math environments, and comments.
     *   3. Split into sentences (respecting abbreviations).
     *   4. Return the last `numSentences` sentences joined.
     *
     * @param text - Full document text.
     * @param cursorOffset - Cursor character offset.
     * @param numSentences - How many trailing sentences to keep.
     * @returns Cleaned context string.
     */
    private extractContextText(
        text: string,
        cursorOffset: number,
        numSentences: number,
    ): string {
        const start = Math.max(0, cursorOffset - MAX_LOOKBACK_CHARS);
        const rawSlice = text.slice(start, cursorOffset);

        const cleaned = this.stripLatex(rawSlice);
        const sentences = this.splitSentences(cleaned);

        if (sentences.length === 0) {
            return cleaned.trim();
        }

        const selected = sentences.slice(-numSentences);
        return selected.join(' ').trim();
    }

    /**
     * Strip LaTeX markup from text, keeping the human-readable content.
     *
     * Handles (in order):
     *   - Line comments (`% ...`)
     *   - Display math (`$$ ... $$`) -- keep inner text
     *   - Inline math (`$ ... $`) -- keep inner text
     *   - Commands with braces (`\cmd{content}`) -- keep content
     *   - Bare commands (`\cmd`) -- remove entirely
     *   - Remaining braces -- remove
     *   - Collapse whitespace
     *
     * @param text - Raw LaTeX source.
     * @returns Cleaned plain text.
     */
    private stripLatex(text: string): string {
        let result = text;

        // Remove line comments (% to end of line), but not escaped \%
        result = result.replace(/(?<!\\)%[^\n]*/g, '');

        // Remove display math delimiters but keep content inside
        // Handle \[ ... \] and $$ ... $$
        result = result.replace(/\\\[([^]*?)\\\]/g, ' $1 ');
        result = result.replace(/\$\$([^]*?)\$\$/g, ' $1 ');

        // Remove inline math delimiters but keep content
        // Careful: only match single $ not preceded/followed by $
        result = result.replace(/(?<!\$)\$(?!\$)([^$]*?)(?<!\$)\$(?!\$)/g, ' $1 ');

        // Remove \begin{env} and \end{env}
        result = result.replace(/\\(?:begin|end)\{[^}]*\}/g, ' ');

        // Remove citation commands entirely (don't keep citation keys as text)
        result = result.replace(
            /\\(?:cite[pt]?|citeauthor|citeyear|citealt|parencite|textcite|autocite|fullcite|footcite|nocite)\*?(?:\[[^\]]*\])?\{[^}]*\}/g,
            ' '
        );

        // Remove commands with braces: \command{content} -> content
        // Apply iteratively because commands can be nested (e.g., \textbf{\emph{word}})
        let prev = '';
        while (prev !== result) {
            prev = result;
            result = result.replace(/\\[a-zA-Z]+\*?\{([^{}]*)\}/g, ' $1 ');
        }

        // Remove commands with optional args: \command[opt]{content} leftovers
        result = result.replace(/\\[a-zA-Z]+\*?\[[^\]]*\]/g, ' ');

        // Remove bare commands: \command followed by non-letter
        result = result.replace(/\\[a-zA-Z]+\*?/g, ' ');

        // Remove remaining braces
        result = result.replace(/[{}]/g, ' ');

        // Remove backslash escapes for special chars (\%, \&, \$, etc.)
        result = result.replace(/\\[%&$#_{}~^]/g, ' ');

        // Collapse whitespace
        result = result.replace(/\s+/g, ' ');

        return result.trim();
    }

    /**
     * Split text into sentences, respecting common abbreviations.
     *
     * The splitter looks for sentence-ending punctuation (`.`, `?`, `!`)
     * followed by whitespace and an uppercase letter or end-of-string.
     * It avoids splitting on known abbreviations (e.g., "e.g.", "Fig.").
     *
     * @param text - Cleaned plain text.
     * @returns Array of sentence strings.
     */
    private splitSentences(text: string): string[] {
        if (!text.trim()) {
            return [];
        }

        const sentences: string[] = [];
        let current = '';

        // Tokenize by whitespace to inspect word-by-word
        const tokens = text.split(/\s+/);

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            current += (current ? ' ' : '') + token;

            // Check if this token ends a sentence
            if (/[.?!]$/.test(token)) {
                // Is the next token capitalized (or are we at the end)?
                const nextToken = tokens[i + 1];
                const atEnd = i === tokens.length - 1;
                const nextIsCapitalized = nextToken && /^[A-Z]/.test(nextToken);

                if (atEnd || nextIsCapitalized) {
                    // Check if this is an abbreviation
                    const wordBeforePunct = token.replace(/[.?!]+$/, '').toLowerCase();
                    const isAbbreviation = ABBREVIATIONS.has(wordBeforePunct);

                    // For "." specifically, also check two-word abbreviations
                    // like "et al." by looking at preceding token
                    let isTwoWordAbbrev = false;
                    if (token === '.' || token.endsWith('.')) {
                        const prevToken = i > 0 ? tokens[i - 1] : '';
                        const twoWord = (prevToken + ' ' + wordBeforePunct).toLowerCase();
                        if (ABBREVIATIONS.has(twoWord)) {
                            isTwoWordAbbrev = true;
                        }
                    }

                    if (!isAbbreviation && !isTwoWordAbbrev) {
                        sentences.push(current.trim());
                        current = '';
                    }
                }
            }
        }

        // Remaining text that did not end with sentence punctuation
        if (current.trim()) {
            sentences.push(current.trim());
        }

        return sentences.filter(s => s.length > 0);
    }

    // ─── Section Identification ─────────────────────────────────────────

    /**
     * Identify the LaTeX section containing the cursor position.
     *
     * Searches backward from the cursor for `\section{...}` or
     * `\subsection{...}` commands. Returns the section title in lowercase.
     * Falls back to heuristic detection of common section headings, then
     * to `"unknown"`.
     *
     * @param text - Full document text.
     * @param cursorOffset - Cursor character offset.
     * @returns Lowercase section name (e.g., "methods", "introduction").
     */
    private identifySection(text: string, cursorOffset: number): string {
        const textBefore = text.slice(0, cursorOffset);

        // Match \section{...}, \subsection{...}, \section*{...}, etc.
        // Take the last match (closest to cursor).
        const sectionPattern = /\\(?:sub)*section\*?\{([^}]+)\}/g;
        let lastMatch: RegExpExecArray | null = null;
        let match: RegExpExecArray | null;

        while ((match = sectionPattern.exec(textBefore)) !== null) {
            lastMatch = match;
        }

        if (lastMatch) {
            return this.stripLatex(lastMatch[1]).toLowerCase().trim();
        }

        // Heuristic fallback: look for common section-like patterns
        // Some documents use \section without braces or use custom commands
        const inferredSection = this.inferSectionFromContent(textBefore);
        if (inferredSection) {
            return inferredSection;
        }

        return 'unknown';
    }

    /**
     * Attempt to infer the section from nearby content when no explicit
     * `\section` command is found. Checks for common heading keywords
     * in the last 500 characters before the cursor.
     *
     * @param textBefore - Document text up to the cursor.
     * @returns Inferred section name or null.
     */
    private inferSectionFromContent(textBefore: string): string | null {
        const tail = textBefore.slice(-500).toLowerCase();

        // Order matters: check more specific names first
        const sectionKeywords: [string, string[]][] = [
            ['abstract', ['abstract']],
            ['introduction', ['introduction']],
            ['background', ['background', 'related work', 'prior work', 'literature review']],
            ['methods', ['methods', 'methodology', 'materials and methods', 'experimental setup',
                         'model description', 'computational methods']],
            ['results', ['results', 'findings', 'experimental results']],
            ['discussion', ['discussion']],
            ['conclusion', ['conclusion', 'conclusions', 'concluding remarks', 'summary']],
            ['acknowledgments', ['acknowledgment', 'acknowledgments', 'acknowledgement']],
            ['appendix', ['appendix']],
        ];

        // Find the keyword that appears latest (closest to cursor)
        let bestSection: string | null = null;
        let bestIndex = -1;

        for (const [sectionName, keywords] of sectionKeywords) {
            for (const keyword of keywords) {
                const idx = tail.lastIndexOf(keyword);
                if (idx > bestIndex) {
                    bestIndex = idx;
                    bestSection = sectionName;
                }
            }
        }

        return bestSection;
    }

    // ─── Key Term Extraction ────────────────────────────────────────────

    /**
     * Extract and rank key terms from the context text.
     *
     * This is the core NLP-inspired extraction pipeline. It uses no ML,
     * relying instead on a combination of heuristics that work well for
     * academic text:
     *
     *   a) **Cleaning**: Remove residual LaTeX artifacts, normalize.
     *   b) **Tokenization**: Split on whitespace and punctuation.
     *   c) **Stopword filtering**: Remove function words and LaTeX commands.
     *   d) **Unigram scoring**: Frequency, capitalization, acronym bonuses.
     *   e) **N-gram extraction**: Bigrams and trigrams without stopword
     *      boundaries receive a specificity bonus.
     *   f) **Section-aware boosting**: Soft score bumps for section-relevant
     *      vocabulary.
     *   g) **Ranking**: Sort by score descending, deduplicate, return top terms.
     *
     * @param contextText - Cleaned text near the cursor.
     * @param section - Current section name (lowercase).
     * @returns Array of key term strings, ordered by relevance (best first).
     */
    private extractKeyTerms(contextText: string, section: string): string[] {
        if (!contextText.trim()) {
            return [];
        }

        // (a) Clean residual artifacts
        const cleaned = this.cleanForTermExtraction(contextText);

        // (b) Tokenize
        const tokens = this.tokenize(cleaned);

        if (tokens.length === 0) {
            return [];
        }

        // Lowercase map for lookups, but keep originals for capitalization check
        const originalTokens = [...tokens];
        const lowerTokens = tokens.map(t => t.toLowerCase());

        // (c) Build frequency map of non-stopword tokens
        const freq = new Map<string, number>();
        for (const token of lowerTokens) {
            if (!this.isStopword(token)) {
                freq.set(token, (freq.get(token) ?? 0) + 1);
            }
        }

        // (d) Score individual (unigram) terms
        const unigramScores = new Map<string, number>();

        for (const [term, count] of freq) {
            let score = 1; // base score

            // Frequency bonus: +2 if the term appears more than once
            if (count > 1) {
                score += 2;
            }

            // Capitalization bonus: +1 if any occurrence was capitalized
            // (likely proper noun or technical term)
            const capitalizedInOriginal = originalTokens.some(
                t => t.toLowerCase() === term && /^[A-Z]/.test(t) && t.length > 1
            );
            if (capitalizedInOriginal) {
                score += 1;
            }

            // Acronym bonus: +2 for 2-6 uppercase letter sequences (STDP, GABA, LTP)
            const isAcronym = originalTokens.some(
                t => t.toLowerCase() === term && /^[A-Z]{2,6}$/.test(t)
            );
            if (isAcronym) {
                score += 2;
            }

            // Length bonus: slightly prefer longer words (more specific)
            if (term.length >= 8) {
                score += 1;
            }

            unigramScores.set(term, score);
        }

        // (e) Extract bigrams and trigrams
        const ngramScores = this.scoreNgrams(lowerTokens, originalTokens);

        // (f) Section-aware boosting
        this.applySectionBoosts(unigramScores, section);
        this.applySectionBoosts(ngramScores, section);

        // (g) Merge, deduplicate, and rank
        const allScored: ScoredTerm[] = [];

        for (const [term, score] of unigramScores) {
            allScored.push({ term, score });
        }
        for (const [term, score] of ngramScores) {
            allScored.push({ term, score });
        }

        // Sort descending by score, then alphabetically for ties
        allScored.sort((a, b) => {
            if (b.score !== a.score) {
                return b.score - a.score;
            }
            return a.term.localeCompare(b.term);
        });

        // Deduplicate: if a unigram is part of a higher-scoring n-gram that
        // is already selected, skip the unigram to avoid redundancy.
        const selected: string[] = [];
        const selectedSet = new Set<string>();

        for (const { term } of allScored) {
            if (selectedSet.has(term)) {
                continue;
            }

            // Check if this unigram is fully contained in an already-selected n-gram
            if (!term.includes(' ')) {
                const subsumed = selected.some(
                    sel => sel.includes(' ') && sel.split(' ').includes(term)
                );
                if (subsumed && selected.length >= MIN_KEY_TERMS) {
                    continue;
                }
            }

            selected.push(term);
            selectedSet.add(term);

            if (selected.length >= MAX_KEY_TERMS) {
                break;
            }
        }

        return selected;
    }

    /**
     * Clean text for term extraction: remove residual non-alphabetic noise,
     * normalize dashes, and collapse whitespace.
     *
     * @param text - Pre-cleaned context text.
     * @returns Further cleaned text suitable for tokenization.
     */
    private cleanForTermExtraction(text: string): string {
        let result = text;

        // Remove numbers-only tokens but keep alphanumeric (e.g., "layer4")
        result = result.replace(/\b\d+\b/g, ' ');

        // Normalize dashes to spaces (hyphenated terms become bigram candidates)
        result = result.replace(/[–—]/g, ' ');

        // Remove punctuation except hyphens within words
        result = result.replace(/[,.;:!?"'()\[\]<>\/\\@#$%^&*+=|~`]/g, ' ');

        // Collapse whitespace
        result = result.replace(/\s+/g, ' ').trim();

        return result;
    }

    /**
     * Tokenize text into words, filtering out very short tokens.
     *
     * @param text - Cleaned text.
     * @returns Array of word tokens.
     */
    private tokenize(text: string): string[] {
        return text
            .split(/\s+/)
            .filter(t => t.length >= 2) // drop single characters
            .filter(t => !/^\d+$/.test(t)); // drop pure numbers
    }

    /**
     * Check if a lowercase token is a stopword or LaTeX command name.
     *
     * @param token - Lowercase token.
     * @returns True if the token should be filtered out.
     */
    private isStopword(token: string): boolean {
        return STOPWORDS.has(token) || LATEX_COMMANDS.has(token) || token.length < 2;
    }

    /**
     * Extract and score bigrams and trigrams from the token sequence.
     *
     * N-grams are formed from consecutive non-stopword tokens. They receive
     * a +3 bonus over unigrams because multi-word phrases are more specific
     * and produce better search queries (e.g., "synaptic plasticity" vs
     * "synaptic" alone).
     *
     * @param lowerTokens - Lowercase token array.
     * @param originalTokens - Original-case token array (parallel to lowerTokens).
     * @returns Map from n-gram string to its score.
     */
    private scoreNgrams(
        lowerTokens: string[],
        originalTokens: string[],
    ): Map<string, number> {
        const scores = new Map<string, number>();

        // Build a boolean mask: true if the token at this index is non-stopword
        const isContent = lowerTokens.map(t => !this.isStopword(t));

        // Bigrams: pairs of consecutive content words
        for (let i = 0; i < lowerTokens.length - 1; i++) {
            if (isContent[i] && isContent[i + 1]) {
                const bigram = lowerTokens[i] + ' ' + lowerTokens[i + 1];

                let score = 3; // n-gram specificity bonus

                // Frequency: count occurrences
                const count = this.countNgramOccurrences(lowerTokens, [lowerTokens[i], lowerTokens[i + 1]]);
                if (count > 1) {
                    score += 2;
                }

                // Capitalization bonus on either word
                if (/^[A-Z]/.test(originalTokens[i]) || /^[A-Z]/.test(originalTokens[i + 1])) {
                    score += 1;
                }

                // Prefer if not already in map or update with higher score
                scores.set(bigram, Math.max(scores.get(bigram) ?? 0, score));
            }
        }

        // Trigrams: triples of consecutive content words
        for (let i = 0; i < lowerTokens.length - 2; i++) {
            if (isContent[i] && isContent[i + 1] && isContent[i + 2]) {
                const trigram = lowerTokens[i] + ' ' + lowerTokens[i + 1] + ' ' + lowerTokens[i + 2];

                let score = 4; // higher specificity bonus for trigrams

                const count = this.countNgramOccurrences(
                    lowerTokens,
                    [lowerTokens[i], lowerTokens[i + 1], lowerTokens[i + 2]],
                );
                if (count > 1) {
                    score += 2;
                }

                scores.set(trigram, Math.max(scores.get(trigram) ?? 0, score));
            }
        }

        return scores;
    }

    /**
     * Count how many times an n-gram appears in the token sequence.
     *
     * @param tokens - Full lowercase token array.
     * @param ngram - The n-gram as an array of tokens.
     * @returns Number of occurrences.
     */
    private countNgramOccurrences(tokens: string[], ngram: string[]): number {
        let count = 0;
        const n = ngram.length;

        for (let i = 0; i <= tokens.length - n; i++) {
            let match = true;
            for (let j = 0; j < n; j++) {
                if (tokens[i + j] !== ngram[j]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                count++;
            }
        }

        return count;
    }

    /**
     * Apply soft section-aware score boosts.
     *
     * Terms that are characteristic of the current section (e.g., "algorithm"
     * in methods, "limitation" in discussion) receive a +1 bonus. This nudges
     * search queries toward section-appropriate citations without hard-filtering
     * any terms.
     *
     * @param scores - Mutable term-to-score map (modified in place).
     * @param section - Current section name (lowercase).
     */
    private applySectionBoosts(scores: Map<string, number>, section: string): void {
        // Normalize section name to match our boost keys
        const normalizedSection = this.normalizeSectionName(section);
        const boostSet = SECTION_BOOSTS[normalizedSection];

        if (!boostSet) {
            return;
        }

        for (const [term, score] of scores) {
            // Check each word in the term (handles n-grams)
            const words = term.split(' ');
            const boosted = words.some(w => boostSet.has(w));
            if (boosted) {
                scores.set(term, score + 1);
            }
        }
    }

    /**
     * Normalize a section title to one of the canonical section names used
     * as keys in {@link SECTION_BOOSTS}.
     *
     * Handles variations like "Materials and Methods" -> "methods",
     * "Results and Discussion" -> "results", etc.
     *
     * @param section - Raw section name (lowercase).
     * @returns Canonical section key, or the original if no match.
     */
    private normalizeSectionName(section: string): string {
        const s = section.toLowerCase().trim();

        if (s.includes('introduction') || s.includes('background') || s.includes('overview')) {
            return 'introduction';
        }
        if (s.includes('method') || s.includes('material') || s.includes('experimental setup')
            || s.includes('model description') || s.includes('computational')) {
            return 'methods';
        }
        if (s.includes('result') || s.includes('finding') || s.includes('experiment')) {
            return 'results';
        }
        if (s.includes('discussion') || s.includes('interpretation')) {
            return 'discussion';
        }
        if (s.includes('conclusion') || s.includes('summary') || s.includes('concluding')) {
            return 'conclusion';
        }

        return s;
    }

    // ─── Citation Detection ─────────────────────────────────────────────

    /**
     * Find all citation keys already used in the document.
     *
     * Matches the following LaTeX citation commands:
     *   - `\cite{key}`, `\cite{key1,key2}`
     *   - `\citep{key}`, `\citet{key}`
     *   - `\parencite{key}`, `\textcite{key}`, `\autocite{key}`
     *   - `\citeauthor{key}`, `\citeyear{key}`, `\citealt{key}`
     *   - `\fullcite{key}`, `\footcite{key}`, `\nocite{key}`
     *
     * Multiple keys within a single command (comma-separated) are split
     * and returned individually. Results are deduplicated.
     *
     * @param text - Full document text.
     * @returns Array of unique citation keys found in the document.
     */
    public findExistingCitations(text: string): string[] {
        const citationPattern =
            /\\(?:cite[pt]?|citeauthor|citeyear|citealt|parencite|textcite|autocite|fullcite|footcite|nocite)\*?\{([^}]+)\}/g;

        const keys = new Set<string>();
        let match: RegExpExecArray | null;

        while ((match = citationPattern.exec(text)) !== null) {
            // Split comma-separated keys: \citep{key1, key2, key3}
            const rawKeys = match[1].split(',');
            for (const key of rawKeys) {
                const trimmed = key.trim();
                if (trimmed) {
                    keys.add(trimmed);
                }
            }
        }

        return Array.from(keys);
    }

    // ─── Document Type Detection ────────────────────────────────────────

    /**
     * Detect the document class from `\documentclass{...}`.
     *
     * @param text - Full document text.
     * @returns The document class name (e.g., "article", "report", "beamer"),
     *   or `"unknown"` if not found.
     */
    private identifyDocumentType(text: string): string {
        // Match \documentclass[options]{classname} or \documentclass{classname}
        const pattern = /\\documentclass(?:\[[^\]]*\])?\{([^}]+)\}/;
        const match = pattern.exec(text);

        if (match) {
            return match[1].trim().toLowerCase();
        }

        return 'unknown';
    }

    // ─── Document-Level Extraction ────────────────────────────────────────

    /**
     * Extract the document title from `\title{...}`.
     *
     * @param text - Full document text.
     * @returns The document title, stripped of LaTeX commands, or empty string.
     */
    private extractDocumentTitle(text: string): string {
        const match = text.match(/\\title\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/);
        if (match) {
            return this.stripLatex(match[1]).trim();
        }
        return '';
    }

    /**
     * Extract the document abstract from `\begin{abstract}...\end{abstract}`.
     *
     * @param text - Full document text.
     * @returns The abstract text, stripped of LaTeX commands, or empty string.
     */
    private extractDocumentAbstract(text: string): string {
        const match = text.match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/);
        if (match) {
            return this.stripLatex(match[1]).trim();
        }
        return '';
    }

    // ─── Paragraph Extraction ───────────────────────────────────────────

    /**
     * Extract the current paragraph surrounding the cursor.
     *
     * Paragraphs in LaTeX are separated by blank lines or `\par` commands.
     * This looks for the nearest paragraph boundaries around the cursor
     * and returns the enclosed text, stripped of LaTeX markup.
     *
     * @param text - Full document text.
     * @param cursorOffset - Cursor character offset.
     * @returns The cleaned text of the current paragraph.
     */
    private extractCurrentParagraph(text: string, cursorOffset: number): string {
        // Find paragraph boundaries: blank lines or \par
        const paragraphBreak = /\n\s*\n|\\par\b/g;

        let paragraphStart = 0;
        let paragraphEnd = text.length;

        // Find the last break before cursor
        let breakMatch: RegExpExecArray | null;
        while ((breakMatch = paragraphBreak.exec(text)) !== null) {
            const breakEnd = breakMatch.index + breakMatch[0].length;
            if (breakEnd <= cursorOffset) {
                paragraphStart = breakEnd;
            } else if (breakMatch.index >= cursorOffset) {
                paragraphEnd = breakMatch.index;
                break;
            }
        }

        const rawParagraph = text.slice(paragraphStart, paragraphEnd);
        return this.stripLatex(rawParagraph);
    }
}

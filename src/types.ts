/**
 * Shared type definitions for the LaTeX Citation Assistant extension.
 *
 * These interfaces define the data contracts between all modules:
 * context extraction, source clients, search engine, ranking, and UI.
 */

// ─── LLM Types ──────────────────────────────────────────────────────────────

/** Supported LLM providers. */
export type LLMProvider = 'anthropic' | 'openai';

/** Configuration for the LLM-powered search pipeline. */
export interface LLMConfig {
    /** Whether LLM-assisted search is enabled. */
    enabled: boolean;
    /** Which LLM provider to use. */
    provider: LLMProvider;
    /** API key for the selected provider. */
    apiKey: string;
    /** Optional model override (empty = use provider default). */
    model: string;
    /** Base URL of an OpenAI-compatible server (empty = api.openai.com). OpenAI provider only. */
    baseUrl: string;
}

/** A claim extracted from the writing context by the LLM. */
export interface ClaimInfo {
    /** The factual or methodological claim made in the text. */
    claim: string;
    /** Type of source that would support this claim. */
    sourceType: string;
    /** How specific the claim is (high, medium, low). */
    specificity: string;
}

/** Result of LLM-powered query generation from document context. */
export interface LLMQueryResult {
    /** 3-5 targeted search queries for academic databases. */
    searchQueries: string[];
    /** A ~100-word hypothetical abstract for SPECTER embedding search. */
    hypotheticalAbstract: string;
    /** 5-10 key terms identified by the LLM. */
    keyTerms: string[];
    /** Claims in the text that need citation support. */
    claimAnalysis: ClaimInfo[];
}

/** A single item scored by the LLM re-ranker. */
export interface LLMRankedItem {
    /** The sourceId of the citation result. */
    sourceId: string;
    /** Relevance score assigned by the LLM (1-10). */
    score: number;
    /** Brief explanation of why this paper is relevant. */
    reason: string;
}

// ─── Context Types ───────────────────────────────────────────────────────────

/** Extracted context from the LaTeX document at the cursor position. */
export interface DocumentContext {
    /** The current LaTeX section name (e.g., "introduction", "methods"). */
    section: string;
    /** Extracted key terms ranked by relevance, used as search queries. */
    keyTerms: string[];
    /** The raw text of the 1-2 sentences before the cursor. */
    contextText: string;
    /** The full current paragraph text. */
    currentParagraph: string;
    /** Citation keys already present in the document (for deduplication). */
    existingCitations: string[];
    /** Document class if detectable (article, report, beamer, etc.). */
    documentType: string;
    /** Document title extracted from \title{...}. */
    documentTitle: string;
    /** Document abstract extracted from \begin{abstract}...\end{abstract}. */
    documentAbstract: string;
}

/** A single extracted term with its relevance score. */
export interface ScoredTerm {
    /** The term text (single word or multi-word phrase). */
    term: string;
    /** Relevance score (higher = more important in context). */
    score: number;
}

// ─── Citation Source Types ────────────────────────────────────────────────────

/** Identifies the source database of a citation result. */
export enum CitationSource {
    Zotero = 'zotero',
    SemanticScholar = 'semantic-scholar',
}

/** A single author of a paper. */
export interface Author {
    firstName?: string;
    lastName?: string;
    /** Full name if first/last not available. */
    name?: string;
}

/** A citation result from any source, normalized to a common format. */
export interface CitationResult {
    /** Unique identifier within the source (Zotero key or S2 paperId). */
    sourceId: string;
    /** Which database this result came from. */
    source: CitationSource;
    /** Paper title. */
    title: string;
    /** List of authors. */
    authors: Author[];
    /** Publication year. */
    year: number | null;
    /** Journal or venue name. */
    journal: string;
    /** Paper abstract (may be truncated). */
    abstract: string;
    /** DOI if available. */
    doi: string;
    /** BibTeX citation key (from Better BibTeX or generated). */
    bibtexKey: string;
    /** Full BibTeX entry (only for Semantic Scholar results). */
    bibtexEntry?: string;
    /** Number of citations (Semantic Scholar only). */
    citationCount?: number;
    /** Number of highly influential citations (Semantic Scholar only). */
    influentialCitationCount?: number;
    /** Model-generated one-line summary (Semantic Scholar TLDR). */
    tldr?: string;
    /** Item type (article, inproceedings, book, etc.). */
    itemType: string;
    /** Relevance score assigned by the ranking algorithm (0-100). */
    relevanceScore: number;
    /** URL to the paper. */
    url?: string;
    /** LLM-generated explanation of why this paper is relevant. */
    relevanceReason?: string;
}

// ─── Search Types ────────────────────────────────────────────────────────────

/** Configuration for a search request. */
export interface SearchRequest {
    /** The document context to search for. */
    context: DocumentContext;
    /** Maximum results per source. */
    maxResultsPerSource: number;
    /** Which sources to search. */
    sources: CitationSource[];
}

/** Result of a search across all sources. */
export interface SearchResponse {
    /** All results, merged and ranked. */
    results: CitationResult[];
    /** Per-source metadata. */
    sourceStats: {
        source: CitationSource;
        totalFound: number;
        returned: number;
        queryTerms: string[];
        durationMs: number;
        llmAssisted?: boolean;
    }[];
    /** Total search duration in milliseconds. */
    totalDurationMs: number;
}

// ─── Configuration Types ─────────────────────────────────────────────────────

/** Typed extension configuration. */
export interface ExtensionConfig {
    zotero: {
        enabled: boolean;
        apiKey: string;
        userId: string;
    };
    semanticScholar: {
        enabled: boolean;
        apiKey: string;
    };
    maxResults: number;
    contextSentences: number;
    suggestionsBibFile: string;
    citationCommand: string;
    excludeCited: boolean;
    llm: LLMConfig;
}

// ─── UI Types ────────────────────────────────────────────────────────────────

/** A QuickPick item enriched with citation data. */
export interface CitationQuickPickItem {
    label: string;
    description: string;
    detail: string;
    citation: CitationResult;
    /** Separator items use this. */
    kind?: number;
}

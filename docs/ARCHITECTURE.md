# Architecture

Technical reference for contributors to the LaTeX Citation Assistant.

---

## Module Dependency Diagram

```
                         extension.ts
                        (entry point)
                             |
            +----------------+----------------+
            |                |                |
            v                v                v
     utils/config     utils/logger     context/extractor
            |                |                |
            |                |         context/stopwords
            |                |
            v                v
         search/engine  <----------  ui/quick-pick
            |       \                     |
            |        \                    v
            v         v             bibtex/writer
    sources/zotero   sources/semantic-scholar
            |         |
            v         v
       search/ranker
            |
            v
         types.ts
      (shared types)
```

All modules import from `types.ts` for shared interfaces and enums. The arrows above show the primary dependency direction: `extension.ts` orchestrates everything, `search/engine` coordinates sources and ranking, and `ui/quick-pick` handles user interaction and delegates to `bibtex/writer` for file I/O.

---

## Module Reference

### `types.ts`

Shared type definitions used across every module. This file defines the data contracts and is the single source of truth for all inter-module communication.

**Key types:**

| Type | Purpose |
|------|---------|
| `DocumentContext` | Extracted context from a LaTeX document: section, key terms, raw text, existing citations, document class |
| `ScoredTerm` | A single term paired with its relevance score |
| `CitationSource` | Enum: `Zotero` or `SemanticScholar` |
| `CitationResult` | Normalized paper metadata from any source -- title, authors, year, journal, abstract, DOI, BibTeX key, relevance score |
| `SearchRequest` | Input to the search engine: context, max results, which sources to query |
| `SearchResponse` | Output from the search engine: ranked results plus per-source statistics |
| `ExtensionConfig` | Typed mirror of the VS Code `latexCite.*` settings |
| `CitationQuickPickItem` | A VS Code QuickPick item enriched with a `CitationResult` reference |

---

### `extension.ts`

Entry point. Registers the four commands and wires together all subsystems.

**Public API:**

- `activate(context: ExtensionContext): void` -- Called by VS Code on `.tex`/`.latex` file open. Initializes logger, config, source clients, search engine, ranker, bibtex writer, status bar, and citation picker. Registers all commands and disposables.
- `deactivate(): void` -- Disposes the logger.

**Registered commands:**

| Command ID | Behavior |
|-----------|----------|
| `latex-cite.suggest` | Extract context at cursor, search all enabled sources in parallel, rank results, show QuickPick |
| `latex-cite.suggestZotero` | Prompt user for a search term, query Zotero, rank with minimal context, show QuickPick |
| `latex-cite.suggestSemanticScholar` | Prompt user for a search term, query Semantic Scholar, rank with minimal context, show QuickPick |
| `latex-cite.analyzeContext` | Extract context at cursor and display it in the output channel (no search) |

---

### `context/extractor.ts`

The NLP-inspired context extraction pipeline. Transforms raw LaTeX source into structured search queries.

**Public API:**

- `ContextExtractor.extractContext(text, cursorOffset, numSentences): DocumentContext`
- `ContextExtractor.findExistingCitations(text): string[]`

**Internal pipeline (in order):**

1. **`extractContextText`** -- Slices up to 2000 characters before cursor, strips LaTeX markup, splits into sentences respecting abbreviations, returns the last N sentences.

2. **`identifySection`** -- Scans backward for `\section{...}` / `\subsection{...}` commands. Falls back to keyword-based inference from the last 500 characters.

3. **`extractKeyTerms`** -- The core term extraction algorithm:
   - Clean residual artifacts (numbers, punctuation, dashes).
   - Tokenize into words (minimum 2 characters).
   - Build frequency map of non-stopword tokens.
   - Score unigrams: base(1) + frequency(+2) + capitalization(+1) + acronym(+2) + length(+1).
   - Score bigrams(+3 base) and trigrams(+4 base) from consecutive content words.
   - Apply section-aware boosts (+1 for section-characteristic vocabulary).
   - Sort by score descending, deduplicate (subsume unigrams into higher-scoring n-grams), return top 8-12 terms.

4. **`findExistingCitations`** -- Regex match on all `\cite*{...}` variants, split comma-separated keys, deduplicate.

5. **`identifyDocumentType`** -- Regex match on `\documentclass{...}`.

6. **`extractCurrentParagraph`** -- Find paragraph boundaries (blank lines or `\par`) around cursor, return stripped content.

**Dependencies:** `types.ts`, `context/stopwords.ts` (175 English stopwords + LaTeX command names).

---

### `context/stopwords.ts`

Two exported constants:

- `STOPWORDS: Set<string>` -- ~175 English function words (articles, pronouns, prepositions, conjunctions, common verbs, quantifiers).
- `LATEX_COMMANDS: Set<string>` -- Common LaTeX command names without backslash (e.g., `textbf`, `emph`, `begin`, `end`) to filter out after markup stripping.

---

### `sources/zotero.ts`

Zotero Web API v3 client.

**Public API:**

- `ZoteroSource(apiKey, userId)` -- Constructor. Creates an Axios instance with Bearer auth.
- `search(context, maxResults): Promise<CitationResult[]>` -- Context-driven search. Builds multiple overlapping queries from key terms (broad + specific groups), executes them in parallel via `Promise.allSettled`, deduplicates by item key.
- `searchByTerm(term, maxResults): Promise<CitationResult[]>` -- Direct single-query search.
- `isConfigured(): boolean` -- Checks that both apiKey and userId are non-empty.

**Query strategy:**

Given key terms `[A, B, C, D, E]`, the method constructs:
- Broad query: `"A B"` (top 1-2 terms)
- Specific queries: `"A B C"`, `"D E"` (groups of 2-3)

Each query hits `/users/{id}/items?q=...&sort=relevance&format=json`.

**Result mapping:**
- Zotero `key` -> `sourceId`
- Better BibTeX keys read from the `extra` field (`bibtex:` or `Citation Key:` patterns)
- Fallback key generation: `LastName2023`
- Year extraction via regex for the first 4-digit number in the date field

**Error handling:** Specific messages for 403 (bad API key), 404 (bad user ID), 429 (rate limited), timeouts.

**Constants:** 25 items max per request, 15-second timeout.

---

### `sources/semantic-scholar.ts`

Semantic Scholar Academic Graph API client.

**Public API:**

- `SemanticScholarSource(apiKey?)` -- Constructor. API key is optional (basic use: 100 requests per 5 minutes).
- `search(context, maxResults): Promise<CitationResult[]>` -- Context-driven search. Joins top 5-6 key terms into a single query.
- `searchByTerm(term, maxResults): Promise<CitationResult[]>` -- Direct single-query search.

**Rate limiting:**

Client-side tracking via a rolling timestamp window. When approaching the limit (90/100 requests), a 3-second delay is injected. When the limit is reached, the client sleeps until the oldest request falls out of the 5-minute window.

**BibTeX generation:**

Each result includes a fully generated `bibtexEntry` string with:
- Correct entry type inferred from venue type (conference -> `@inproceedings`, journal -> `@article`, etc.)
- Author names formatted as `"Last, First and Last, First"`
- Special character escaping for BibTeX (`&`, `%`, `#`, `_`, `~`, `^`)
- Optional fields (DOI, abstract) omitted when empty rather than emitted as blank

**Constants:** 20-second timeout, fields requested include `paperId`, `title`, `abstract`, `authors`, `year`, `citationCount`, `externalIds`, `publicationVenue`, `url`, `openAccessPdf`.

---

### `search/engine.ts`

Search orchestration layer.

**Public API:**

- `SearchEngine(zotero, semanticScholar, ranker)` -- Constructor.
- `search(request): Promise<SearchResponse>` -- Multi-source search. Builds a list of source queries, executes all in parallel via `Promise.allSettled`, collects per-source timing statistics, passes merged results through the ranker, returns `SearchResponse`.
- `searchSingleSource(source, context, maxResults): Promise<CitationResult[]>` -- Single-source search (bypasses orchestration).

**Key behavior:**
- Source failures are isolated: a timeout from Zotero does not block Semantic Scholar results.
- Timing statistics (milliseconds per source) are included in every response for diagnostics.
- Logs total result count and overall duration.

---

### `search/ranker.ts`

Multi-factor scoring and deduplication algorithm.

**Public API:**

- `ResultRanker.rankResults(results, context): CitationResult[]` -- Score, deduplicate, normalize, and sort.

**Algorithm (three passes):**

**Pass 1 -- Deduplication:**
Papers appearing in both Zotero and Semantic Scholar are detected by:
1. DOI match (exact, case-insensitive)
2. Title similarity (Dice coefficient on character bigrams, threshold >= 0.85)

When matched, the Zotero version is kept but inherits the S2 citation count.

**Pass 2 -- Scoring (0-100 raw scale):**

| Sub-score | Range | Algorithm |
|-----------|-------|-----------|
| Title relevance | 0-30 | `(matches / total_terms) * 30` + 5pt bonus for exact phrase match of top 3 terms |
| Abstract relevance | 0-20 | `(matches / total_terms) * 20` |
| Section alignment | 0-10 | 5pts for title keyword matching section vocabulary + 5pts for highly-cited papers in Introduction |
| Citation count | 0-15 | `min(15, log10(count + 1) * 5)` -- only for S2 results |
| Recency | 0-10 | Tiered: <=2yr=10, <=5yr=7, <=10yr=4, >10yr=1 |
| Zotero bonus | 0-5 | Flat +5 for Zotero-sourced results |
| Already-cited penalty | -50-0 | -50 if `bibtexKey` appears in `context.existingCitations` |

**Pass 3 -- Normalization:**
Raw scores are linearly rescaled so that max -> 100 and min -> 0. If all scores are equal, every result receives 50.

**Title similarity (Dice coefficient):**
```
similarity = 2 * |intersection(bigrams_a, bigrams_b)| / (|bigrams_a| + |bigrams_b|)
```
Titles are lowercased and stripped of non-alphanumeric characters before bigram extraction.

---

### `bibtex/writer.ts`

Filesystem I/O for BibTeX entries.

**Public API:**

- `BibtexWriter.writeEntry(entry, workspaceRoot, bibFileName): Promise<void>` -- Append a BibTeX entry to a `.bib` file. Idempotent: skips if the citation key already exists. Creates the file and parent directories if needed.
- `BibtexWriter.generateBibtexEntry(result): string` -- Generate a formatted BibTeX string from a `CitationResult`.

**Item type mapping:**
`journalArticle` -> `@article`, `conferencePaper` -> `@inproceedings`, `book` -> `@book`, `thesis` -> `@phdthesis`, `techreport` -> `@techreport`, `preprint` -> `@article`, fallback -> `@misc`.

---

### `ui/quick-pick.ts`

Enhanced VS Code QuickPick for citation selection.

**Public API:**

- `CitationPicker(bibtexWriter)` -- Constructor.
- `showResults(results, editor, position, config): Promise<void>` -- Display ranked results grouped by source with rich formatting, handle selection.

**Behavior on selection:**
1. Insert `\cite{key}` (or configured command) at the cursor position.
2. For Semantic Scholar results, write BibTeX entry to the suggestions file via `BibtexWriter`.
3. Show confirmation message with a "Show Details" action that dumps full paper metadata to the output channel.

**Formatting:**
- Source icons: `$(library)` for Zotero, `$(globe)` for Semantic Scholar.
- Description: `"LastName et al., 2023"` format.
- Detail line: journal, year, citation count (S2 only), relevance score -- separated by bullet characters.
- Results grouped under "From Your Zotero Library" and "From Semantic Scholar" section headers.

---

### `ui/status-bar.ts`

Status bar item management.

**Public API:**

- `StatusBarManager` implements `vscode.Disposable`.
- `showReady()` -- Idle state: `$(search) Citations`.
- `showBusy(message)` -- Spinning animation during search.
- `showResults(zoteroCount, s2Count)` -- Result counts: `$(check) Z:5 S2:12`.
- `showError(message)` -- Error indicator.

Positioned at `StatusBarAlignment.Right` with priority 100. Clicking it triggers `latex-cite.suggest`.

---

### `utils/config.ts`

Configuration reader.

**Public API:**

- `getConfig(): ExtensionConfig` -- Reads from `vscode.workspace.getConfiguration('latexCite')` and returns a typed config object. Not cached -- always returns a fresh snapshot reflecting the latest user settings.

---

### `utils/logger.ts`

Singleton logging utility.

**Public API:**

- `getLogger(): Logger` -- Returns the singleton Logger instance (creates the `"LaTeX Citations"` output channel on first call).
- `Logger.info(message)`, `Logger.warn(message)`, `Logger.error(message)`, `Logger.debug(message)` -- Timestamped, level-prefixed log lines.
- `Logger.show()` -- Reveals the output channel in the VS Code UI.
- `Logger.dispose()` -- Disposes the output channel.

---

## Data Flow: Keypress to Citation Insertion

```
User presses Ctrl+Shift+Z in a .tex file
        |
        v
extension.ts: latex-cite.suggest command handler
        |
        +-- Validate: active editor exists, document is LaTeX
        |
        v
ContextExtractor.extractContext(documentText, cursorOffset, numSentences)
        |
        +-- stripLatex() -> splitSentences() -> extractKeyTerms()
        +-- identifySection()
        +-- findExistingCitations()
        +-- identifyDocumentType()
        |
        v
    DocumentContext {
        section: "methods",
        keyTerms: ["synaptic plasticity", "STDP", "learning rule", ...],
        contextText: "...the text near cursor...",
        existingCitations: ["Smith2020", "Jones2021"],
        ...
    }
        |
        v
SearchEngine.search(request)
        |
        +-- ZoteroSource.search(context, maxResults)     --|
        |       (multiple parallel API calls)              |-- Promise.allSettled
        +-- SemanticScholarSource.search(context, maxResults) --|
        |
        v
    CitationResult[] (merged from both sources)
        |
        v
ResultRanker.rankResults(results, context)
        |
        +-- deduplicateResults() -- merge by DOI or Dice(title) >= 0.85
        +-- computeRawScore() per result -- 7 sub-scores
        +-- normalize to 0-100
        +-- sort descending
        |
        v
    CitationResult[] (ranked, deduplicated, normalized)
        |
        v
CitationPicker.showResults(results, editor, position, config)
        |
        +-- Build QuickPick items grouped by source
        +-- User selects a paper
        |
        v
    editor.edit(insert "\cite{Smith2023}" at cursor)
        |
        +-- If source == SemanticScholar:
        |       BibtexWriter.writeEntry(result, workspaceRoot, "suggestions.bib")
        |
        v
    Confirmation message shown
```

---

## Design Decisions

**No ML/AI for term extraction.** The extension uses heuristic NLP (frequency, capitalization, n-grams, section boosting) rather than embedding models or LLMs. This keeps the extension lightweight (~100KB bundled), avoids external dependencies, and eliminates privacy concerns about sending manuscript text to language model APIs.

**Server-side search over local filtering.** The Zotero client constructs multiple API queries rather than fetching the user's entire library. This is more scalable for large libraries (thousands of items) and respects the API's own relevance ranking.

**Parallel source queries with `Promise.allSettled`.** Source failures are isolated. A Zotero timeout does not block Semantic Scholar results. This makes the extension resilient to transient network issues.

**Zotero-preferred deduplication.** When a paper appears in both sources, the Zotero version is kept (preserving the user's Better BibTeX key and metadata preferences) but the Semantic Scholar citation count is inherited for ranking purposes.

**Separate suggestions.bib file.** Semantic Scholar entries are written to a dedicated file rather than the user's main bibliography. This avoids polluting curated reference collections and makes it easy to review and clean up auto-generated entries.

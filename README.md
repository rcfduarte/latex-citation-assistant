# LaTeX Citation Assistant

**Context-aware citation suggestions from Zotero and Semantic Scholar, right inside VS Code.**

[![VS Code Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/renato-duarte.latex-citation-assistant)](https://marketplace.visualstudio.com/items?itemName=renato-duarte.latex-citation-assistant)
[![Downloads](https://img.shields.io/visual-studio-marketplace/d/renato-duarte.latex-citation-assistant)](https://marketplace.visualstudio.com/items?itemName=renato-duarte.latex-citation-assistant)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/renato-duarte.latex-citation-assistant)](https://marketplace.visualstudio.com/items?itemName=renato-duarte.latex-citation-assistant)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

![Screenshot](resources/screenshot.png)

Stop manually searching for references. LaTeX Citation Assistant reads the text around your cursor, extracts key terms using lightweight NLP, searches your Zotero library and Semantic Scholar in parallel, and presents ranked results -- all in under a second. Select a paper and the citation command is inserted at your cursor. No AI models, no cloud processing of your manuscript, no API keys required for basic use.

---

## Features

### Context-Aware Citation Suggestions
The extension analyzes the sentences around your cursor to understand what you are writing about. It extracts key terms -- including multi-word phrases, acronyms, and section-relevant vocabulary -- without relying on any AI or language model. The extracted terms drive targeted searches against your configured citation sources.

### Dual-Source Search: Zotero + Semantic Scholar
Search your personal Zotero library and the Semantic Scholar academic database simultaneously. Results from both sources are merged, deduplicated, and displayed in a single ranked list with clear source indicators so you always know where each suggestion came from.

### Server-Side Search, Not Naive Filtering
Rather than downloading your entire Zotero library and filtering locally, the extension constructs multiple targeted queries from your document context and executes them against the Zotero Web API. This means fast, relevant results even for libraries with thousands of items.

### Intelligent Multi-Factor Ranking
Results are scored on a 0-100 scale using seven independent factors: title relevance, abstract relevance, section alignment, citation count, recency, source provenance (Zotero library items get a bonus), and deduplication of already-cited papers. The algorithm surfaces the most useful citations first.

### BibTeX Auto-Generation for Semantic Scholar Results
When you select a paper from Semantic Scholar, a properly formatted BibTeX entry is automatically generated and appended to a dedicated `suggestions.bib` file in your workspace. The entry includes author names, title, journal/proceedings, year, DOI, and abstract -- ready to be included in your bibliography.

### Configurable Citation Commands
Choose the citation command that matches your LaTeX setup: `\cite`, `\citep`, `\citet`, `\parencite`, `\textcite`, or `\autocite`. The selected command is inserted at your cursor position with the correct citation key.

### NLP-Inspired Term Extraction
The context extraction pipeline uses frequency analysis, capitalization detection, acronym recognition, n-gram assembly (bigrams and trigrams), and section-aware boosting to identify the most relevant terms from your writing. No external NLP libraries or machine learning models are required.

---

## Quick Start

1. **Install** the extension from the VS Code Marketplace or by searching "LaTeX Citation Assistant" in the Extensions view.

2. **Configure Zotero** (optional but recommended):
   - Go to [zotero.org/settings/keys](https://www.zotero.org/settings/keys) and create an API key with read access to your library.
   - Note your User ID from the same page.
   - Open VS Code Settings and search for "LaTeX Citation".
   - Enter your API key and User ID.

3. **Use it**: Open a `.tex` file, place your cursor where you want a citation, and press `Ctrl+Shift+Z` (or `Cmd+Shift+Z` on macOS). Select a paper from the ranked suggestions and the citation is inserted.

Semantic Scholar works out of the box with no configuration. An optional API key can be added for higher rate limits.

---

## Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| **LaTeX Citations: Suggest Citations from Context** | `Ctrl+Shift+Z` | Analyze the text around your cursor and suggest citations from all enabled sources |
| **LaTeX Citations: Search Zotero Library** | -- | Open a search box to query your Zotero library directly |
| **LaTeX Citations: Search Semantic Scholar** | `Ctrl+Shift+S` | Open a search box to query Semantic Scholar directly |
| **LaTeX Citations: Analyze Document Context** | -- | Display the extracted context (section, key terms, existing citations) in the output panel |

---

## Settings

All settings are under the `latexCite` namespace. Open Settings and search for "LaTeX Citation" to find them.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `latexCite.zotero.enabled` | boolean | `true` | Enable Zotero library search |
| `latexCite.zotero.apiKey` | string | `""` | Your Zotero API key ([get one here](https://www.zotero.org/settings/keys)) |
| `latexCite.zotero.userId` | string | `""` | Your Zotero user ID (shown on the API key settings page) |
| `latexCite.semanticScholar.enabled` | boolean | `true` | Enable Semantic Scholar search for discovering papers outside your library |
| `latexCite.semanticScholar.apiKey` | string | `""` | Optional Semantic Scholar API key for higher rate limits ([request one here](https://www.semanticscholar.org/product/api#api-key)) |
| `latexCite.maxResults` | number | `20` | Maximum number of citation suggestions to display (5-50) |
| `latexCite.contextSentences` | number | `2` | Number of sentences before the cursor to analyze for context (1-5) |
| `latexCite.suggestionsBibFile` | string | `"suggestions.bib"` | BibTeX file for Semantic Scholar entries, relative to workspace root |
| `latexCite.citationCommand` | string | `"\\cite"` | LaTeX citation command to insert. Options: `\cite`, `\citep`, `\citet`, `\parencite`, `\textcite`, `\autocite` |
| `latexCite.excludeCited` | boolean | `true` | Demote papers already cited in the document (they receive a -50 point penalty in ranking) |

---

## How It Works

The extension operates as a three-stage pipeline, all running locally except for the API calls to Zotero and Semantic Scholar.

### Stage 1: Context Extraction

When you invoke the suggest command, the extension reads up to 2000 characters before your cursor and processes them through an NLP-inspired pipeline:

1. **LaTeX stripping** -- Removes commands, math delimiters, comments, and environments while preserving the readable text content.
2. **Sentence splitting** -- Breaks text into sentences while respecting common abbreviations (e.g., "et al.", "Fig.", "i.e.").
3. **Tokenization and stopword filtering** -- Splits into words and removes function words, articles, and LaTeX command names.
4. **Term scoring** -- Each term receives a base score modified by: frequency (repeated terms score higher), capitalization (proper nouns and technical terms), acronym detection (2-6 uppercase letters like STDP, GABA), and word length (longer words tend to be more specific).
5. **N-gram extraction** -- Consecutive content words are assembled into bigrams and trigrams (e.g., "synaptic plasticity", "recurrent neural network") which receive a specificity bonus.
6. **Section-aware boosting** -- The current LaTeX section is detected (Introduction, Methods, Results, Discussion, Conclusion) and terms characteristic of that section receive a soft score bump.

The top 8-12 terms are returned as search queries.

### Stage 2: Parallel Search

The extracted key terms are sent to each enabled source simultaneously:

- **Zotero**: Multiple overlapping queries are constructed from term groups and executed in parallel against the Zotero Web API v3. Results are deduplicated by item key.
- **Semantic Scholar**: The top 5-6 terms are joined into a single focused query sent to the Academic Graph API. BibTeX entries are generated on the fly for each result.

Both searches use `Promise.allSettled`, so a failure in one source does not block results from the other. Per-source timing statistics are logged for diagnostics.

### Stage 3: Intelligent Ranking

All results are merged and scored on a 0-100 scale:

| Factor | Max Points | Method |
|--------|-----------|--------|
| Title relevance | 30 | Fraction of key terms found in the title, plus a bonus for exact phrase matches |
| Abstract relevance | 20 | Fraction of key terms found in the abstract |
| Citation count | 15 | Logarithmic scale: `min(15, log10(citations + 1) * 5)` |
| Recency | 10 | 0-2 years: 10 pts, 3-5 years: 7 pts, 6-10 years: 4 pts, >10 years: 1 pt |
| Section alignment | 10 | Bonus for papers whose titles match section-typical keywords |
| Zotero bonus | 5 | Flat bonus for papers from your personal library |
| Already-cited penalty | -50 | Papers already cited in the document are demoted |

After scoring, results are normalized so the best result maps to 100 and the worst to 0, then sorted in descending order. Cross-source duplicates (matched by DOI or title similarity via the Dice coefficient) are merged, with Zotero entries preferred but inheriting Semantic Scholar citation counts.

---

## Semantic Scholar Integration

When you select a Semantic Scholar result, two things happen:

1. The citation command (e.g., `\cite{Smith2023}`) is inserted at your cursor.
2. The full BibTeX entry is appended to the `suggestions.bib` file in your workspace root (configurable via `latexCite.suggestionsBibFile`).

To use these citations in your document, add the suggestions file to your bibliography:

```latex
\bibliography{references,suggestions}
% or with biblatex:
\addbibresource{references.bib}
\addbibresource{suggestions.bib}
```

The writer checks for duplicate keys before appending, so running the command multiple times for the same paper is safe.

---

## Requirements

- **VS Code** 1.74 or later (or compatible editors like Cursor, Windsurf)
- **Internet connection** for Zotero API and Semantic Scholar API calls
- **Zotero account with API key** (optional, but required for Zotero search)
  - Create a key at [zotero.org/settings/keys](https://www.zotero.org/settings/keys) with "Allow library access" enabled
  - Note your numeric User ID from the same page
- **Semantic Scholar API key** (optional, for higher rate limits -- basic use works without one)

---

## FAQ

**Q: Do I need both Zotero and Semantic Scholar?**
No. Either source works independently. Zotero searches your personal library; Semantic Scholar searches the broader academic literature. Using both gives you the best results: your own curated references plus new discoveries.

**Q: Does this extension send my manuscript to any server?**
No. Only the extracted search terms (typically 8-12 words) are sent to the Zotero and Semantic Scholar APIs. Your manuscript text stays local.

**Q: Why are my Zotero results not showing?**
Check that you have entered both your API key and User ID in the extension settings. You can verify your credentials at [zotero.org/settings/keys](https://www.zotero.org/settings/keys). Use the "Analyze Document Context" command to see what terms the extension is extracting.

**Q: How does the extension decide which terms to search for?**
It uses a lightweight NLP pipeline that scores words by frequency, capitalization, acronym patterns, and section context. No machine learning models are involved. Use the "Analyze Document Context" command to inspect the extracted terms.

**Q: Can I use this with `biblatex` commands like `\parencite`?**
Yes. Change the `latexCite.citationCommand` setting to your preferred command. All standard `natbib` and `biblatex` citation commands are supported.

**Q: What happens if Semantic Scholar is slow or unavailable?**
The extension queries sources in parallel using `Promise.allSettled`. If Semantic Scholar times out or returns an error, Zotero results are still displayed normally (and vice versa). Rate limiting is handled client-side with automatic backoff.

**Q: I use Better BibTeX with Zotero. Are my citation keys preserved?**
Yes. The extension reads Better BibTeX citation keys from the Zotero `extra` field (both `bibtex:` and `Citation Key:` formats). If no Better BibTeX key is found, it generates a `LastName2023`-style key as fallback.

**Q: Can I adjust how many sentences the extension reads for context?**
Yes. Change `latexCite.contextSentences` (1-5). More sentences provide broader context but may introduce noise for very specific citation needs. The default of 2 works well for most writing.

---

## Contributing

Contributions are welcome. To get started:

1. Fork the repository and clone it locally.
2. Install dependencies: `npm install`
3. Open the project in VS Code and press `F5` to launch the Extension Development Host.
4. Make your changes in the `src/` directory.
5. Run the linter: `npm run lint`
6. Compile: `npm run compile`
7. Submit a pull request with a clear description of the change.

Please see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a technical overview of the codebase and [docs/PUBLISHING.md](docs/PUBLISHING.md) for packaging and release instructions.

---

## License

[MIT](LICENSE) -- Copyright 2026 Renato Duarte.

/**
 * Stopwords and LaTeX command lists for text preprocessing.
 *
 * These sets are used by the ContextExtractor to filter out noise from LaTeX
 * documents before extracting meaningful key terms for citation search queries.
 *
 * STOPWORDS: Standard English function words, pronouns, prepositions, conjunctions,
 * and common verbs that carry little semantic weight for information retrieval.
 *
 * LATEX_COMMANDS: LaTeX command names (without backslash) that appear as tokens
 * after stripping backslashes. These are filtered to avoid polluting search queries
 * with typesetting instructions.
 */

/**
 * Standard English stopwords for filtering during term extraction.
 *
 * This set contains approximately 175 words including:
 * - Articles and determiners
 * - Pronouns (personal, possessive, demonstrative, relative)
 * - Prepositions and conjunctions
 * - Common auxiliary and linking verbs
 * - Common adverbs and quantifiers
 * - Miscellaneous high-frequency, low-information words
 */
export const STOPWORDS: Set<string> = new Set([
    // Articles and determiners
    "a", "an", "the", "this", "that", "these", "those",
    "some", "any", "each", "every", "all", "both", "few",
    "more", "most", "other", "another", "such", "no", "nor",
    "not", "only", "own", "same",

    // Personal pronouns
    "i", "me", "my", "myself", "mine",
    "you", "your", "yourself", "yours",
    "he", "him", "his", "himself",
    "she", "her", "hers", "herself",
    "it", "its", "itself",
    "we", "us", "our", "ours", "ourselves",
    "they", "them", "their", "theirs", "themselves",

    // Relative and interrogative pronouns
    "who", "whom", "whose", "which", "what",
    "whoever", "whatever", "whichever",

    // Demonstratives and existentials
    "here", "there", "where", "when", "why", "how",

    // Prepositions
    "in", "on", "at", "to", "for", "with", "from", "by",
    "about", "against", "between", "through", "during", "before",
    "after", "above", "below", "up", "down", "out", "off",
    "over", "under", "again", "further", "into", "onto", "upon",
    "within", "without", "along", "across", "around", "among",
    "beside", "besides", "beyond", "throughout", "toward", "towards",
    "until", "unto",

    // Conjunctions
    "and", "but", "or", "yet", "so", "because", "since",
    "while", "although", "though", "if", "unless", "than",
    "whether", "either", "neither", "however", "therefore",
    "moreover", "furthermore", "nevertheless", "meanwhile",
    "otherwise", "whereas", "whereby",

    // Auxiliary and modal verbs
    "be", "been", "being", "am", "is", "are", "was", "were",
    "have", "has", "had", "having",
    "do", "does", "did", "doing",
    "will", "would", "shall", "should",
    "can", "could", "may", "might", "must",
    "need", "dare", "ought", "used",

    // Common verbs with low semantic value
    "get", "got", "gets", "getting",
    "make", "made", "makes", "making",
    "go", "goes", "went", "gone", "going",
    "come", "came", "comes", "coming",
    "take", "took", "takes", "taken", "taking",
    "give", "gave", "gives", "given", "giving",
    "say", "said", "says", "saying",
    "know", "knew", "knows", "known",
    "see", "saw", "seen", "sees",
    "seem", "seems", "seemed",
    "let", "put",

    // Common adverbs
    "very", "also", "just", "then", "now", "still", "already",
    "often", "always", "never", "sometimes", "usually",
    "too", "quite", "rather", "really", "well", "even",
    "perhaps", "maybe", "indeed", "thus", "hence",
    "much", "many", "several", "enough",

    // Miscellaneous function words
    "as", "of", "etc", "one", "two", "first", "new",
    "like", "way", "thing", "things", "able",

    // Common academic filler (low retrieval value)
    "based", "shown", "present", "presented", "proposed",
    "used", "using", "respectively", "particular",
    "given", "certain", "due", "may", "can",
]);

/**
 * Common LaTeX command names that should be stripped during text cleaning.
 *
 * These are the command names without the leading backslash. After LaTeX
 * stripping removes `\command{...}` structures, residual command-name tokens
 * may remain; this set catches them during the stopword filtering pass.
 *
 * Includes:
 * - Text formatting commands (textbf, textit, emph, ...)
 * - Sectioning commands (section, subsection, chapter, ...)
 * - Reference and citation commands (ref, label, cite, ...)
 * - Document structure (begin, end, documentclass, usepackage, ...)
 * - Math commands and common symbols (frac, sqrt, sum, alpha, ...)
 * - Spacing and layout (hspace, vspace, noindent, ...)
 * - List and float commands (item, caption, includegraphics, ...)
 */
export const LATEX_COMMANDS: Set<string> = new Set([
    // Text formatting
    "textbf", "textit", "texttt", "textrm", "textsf", "textsc",
    "emph", "underline", "overline", "mbox", "makebox",
    "bf", "it", "tt", "rm", "sf", "sc", "sl",
    "bfseries", "itshape", "ttfamily", "rmfamily",
    "tiny", "scriptsize", "footnotesize", "small", "normalsize",
    "large", "Large", "LARGE", "huge", "Huge",

    // Sectioning
    "part", "chapter", "section", "subsection", "subsubsection",
    "paragraph", "subparagraph",

    // References and citations
    "ref", "eqref", "pageref", "autoref", "nameref", "hyperref",
    "label", "tag",
    "cite", "citep", "citet", "citeauthor", "citeyear", "citealt",
    "parencite", "textcite", "autocite", "fullcite", "footcite",
    "nocite", "bibliography", "bibliographystyle",
    "addbibresource", "printbibliography",

    // Document structure
    "documentclass", "usepackage", "RequirePackage",
    "begin", "end",
    "newcommand", "renewcommand", "providecommand",
    "newenvironment", "renewenvironment",
    "def", "let", "setlength", "setcounter",
    "input", "include", "includeonly",

    // Environments and floats
    "item", "caption", "subcaption",
    "includegraphics", "graphicspath",
    "figure", "table", "tabular", "array", "equation", "align",
    "enumerate", "itemize", "description",

    // Cross-referencing and footnotes
    "footnote", "footnotemark", "footnotetext",
    "marginpar", "thanks",

    // Spacing and layout
    "par", "newline", "linebreak", "pagebreak", "newpage", "clearpage",
    "hspace", "vspace", "hfill", "vfill",
    "noindent", "indent",
    "centering", "raggedright", "raggedleft",
    "flushleft", "flushright", "center",
    "quad", "qquad", "enspace", "thinspace",
    "smallskip", "medskip", "bigskip",

    // Math operators and functions
    "frac", "dfrac", "tfrac", "cfrac",
    "sqrt", "root",
    "sum", "prod", "coprod",
    "int", "iint", "iiint", "oint",
    "lim", "limsup", "liminf",
    "sup", "inf", "max", "min",
    "log", "ln", "exp", "sin", "cos", "tan",
    "sec", "csc", "cot", "arcsin", "arccos", "arctan",
    "sinh", "cosh", "tanh",
    "det", "dim", "ker", "hom",
    "arg", "deg", "gcd",
    "binom", "tbinom", "dbinom",
    "pmod", "bmod",
    "text", "mathrm", "mathbf", "mathit", "mathcal", "mathbb",
    "mathfrak", "mathsf", "mathtt",
    "boldsymbol", "hat", "bar", "tilde", "vec", "dot", "ddot",
    "overrightarrow", "overleftarrow",
    "overbrace", "underbrace",
    "left", "right", "bigl", "bigr", "Bigl", "Bigr",
    "middle",
    "displaystyle", "textstyle", "scriptstyle",
    "limits", "nolimits",
    "overset", "underset", "stackrel",
    "phantom", "vphantom", "hphantom",

    // Math environments
    "aligned", "gathered", "split", "cases", "matrix",
    "pmatrix", "bmatrix", "vmatrix", "Vmatrix",
    "multline", "eqnarray",

    // Greek letters (lowercase)
    "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon",
    "zeta", "eta", "theta", "vartheta",
    "iota", "kappa", "lambda", "mu", "nu", "xi",
    "pi", "varpi", "rho", "varrho",
    "sigma", "varsigma", "tau", "upsilon",
    "phi", "varphi", "chi", "psi", "omega",

    // Greek letters (uppercase)
    "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi",
    "Sigma", "Upsilon", "Phi", "Psi", "Omega",

    // Common math symbols (as command names)
    "infty", "partial", "nabla", "forall", "exists",
    "nexists", "emptyset", "varnothing",
    "in", "notin", "subset", "supset", "subseteq", "supseteq",
    "cup", "cap", "setminus", "cdot", "times", "otimes", "oplus",
    "leq", "geq", "neq", "approx", "equiv", "sim", "simeq",
    "propto", "perp", "parallel",
    "rightarrow", "leftarrow", "leftrightarrow",
    "Rightarrow", "Leftarrow", "Leftrightarrow",
    "mapsto", "hookrightarrow",
    "ldots", "cdots", "vdots", "ddots",
    "prime", "backslash",
    "ell", "hbar", "imath", "jmath",
    "Re", "Im",

    // Theorem-like environments
    "theorem", "lemma", "proposition", "corollary",
    "definition", "remark", "example", "proof",
    "qed", "qedhere",

    // Miscellaneous
    "maketitle", "title", "author", "date", "abstract",
    "keywords", "thanks",
    "appendix", "tableofcontents", "listoffigures", "listoftables",
    "pagestyle", "thispagestyle",
    "color", "textcolor", "colorbox",
    "url", "href",
    "verb", "verbatim", "lstlisting",
    "rule", "hline", "cline",
    "multicolumn", "multirow",
    "toprule", "midrule", "bottomrule",
]);

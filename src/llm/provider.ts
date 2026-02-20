/**
 * LLM provider interface for the LaTeX Citation Assistant.
 *
 * Defines a minimal contract for LLM providers. Implementations handle
 * the HTTP calls to their respective APIs (Anthropic, OpenAI) while
 * callers only interact through this interface.
 */

/** Options for an LLM completion request. */
export interface LLMRequestOptions {
    /** Sampling temperature (0-1). Lower = more deterministic. */
    temperature?: number;
    /** Maximum tokens in the response. */
    maxTokens?: number;
    /** Request timeout in milliseconds. */
    timeoutMs?: number;
}

/**
 * Interface that all LLM providers must implement.
 *
 * Returns raw string responses — JSON parsing happens in the callers
 * (QueryGenerator, LLMRanker).
 */
export interface LLMProviderInterface {
    /**
     * Send a completion request to the LLM.
     *
     * @param systemPrompt - The system-level instruction.
     * @param userPrompt   - The user message content.
     * @param options      - Optional request parameters.
     * @returns The LLM's text response.
     */
    complete(
        systemPrompt: string,
        userPrompt: string,
        options?: LLMRequestOptions,
    ): Promise<string>;

    /** Whether this provider has valid credentials configured. */
    isConfigured(): boolean;

    /** Human-readable provider name (e.g., "Anthropic", "OpenAI"). */
    readonly name: string;
}

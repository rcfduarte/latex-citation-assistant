/**
 * OpenAI API provider for the LaTeX Citation Assistant.
 *
 * Direct HTTP calls via axios to the OpenAI Chat Completions API, or to any
 * OpenAI-compatible server (Ollama, llama.cpp, LiteLLM) when a base URL is set.
 * No SDK dependency required.
 */

import axios from 'axios';
import { LLMProviderInterface, LLMRequestOptions } from './provider';

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 15_000;

export class OpenAIProvider implements LLMProviderInterface {
    readonly name = 'OpenAI';
    private readonly apiKey: string;
    private readonly model: string;
    private readonly baseUrl: string;

    /**
     * @param apiKey  - API key; may be empty for a local server that needs none.
     * @param model   - Model name (default gpt-4o-mini).
     * @param baseUrl - Base URL of an OpenAI-compatible API, up to and including
     *                  `/v1` (e.g. `http://127.0.0.1:11434/v1`). Empty means OpenAI.
     */
    constructor(apiKey: string, model?: string, baseUrl?: string) {
        this.apiKey = apiKey;
        this.model = model || DEFAULT_MODEL;
        this.baseUrl = (baseUrl && baseUrl.trim()) ? baseUrl.trim().replace(/\/+$/, '') : DEFAULT_OPENAI_BASE_URL;
    }

    /** True for a custom (non-OpenAI) server. */
    get isCustomEndpoint(): boolean {
        return this.baseUrl !== DEFAULT_OPENAI_BASE_URL;
    }

    /** Full URL of the chat-completions route. */
    get chatCompletionsUrl(): string {
        return `${this.baseUrl}/chat/completions`;
    }

    isConfigured(): boolean {
        return this.apiKey.length > 0 || this.isCustomEndpoint;
    }

    async complete(
        systemPrompt: string,
        userPrompt: string,
        options?: LLMRequestOptions,
    ): Promise<string> {
        const temperature = options?.temperature ?? 0.3;
        const maxTokens = options?.maxTokens ?? 800;
        const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        const response = await axios.post(
            this.chatCompletionsUrl,
            {
                model: this.model,
                max_tokens: maxTokens,
                temperature,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
            },
            {
                headers,
                timeout: timeoutMs,
            },
        );

        const choices = response.data?.choices;
        if (Array.isArray(choices) && choices.length > 0) {
            return choices[0].message?.content ?? '';
        }

        throw new Error('Unexpected OpenAI API response format');
    }
}

/**
 * OpenAI API provider for the LaTeX Citation Assistant.
 *
 * Direct HTTP calls via axios to the OpenAI Chat Completions API.
 * No SDK dependency required.
 */

import axios from 'axios';
import { LLMProviderInterface, LLMRequestOptions } from './provider';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 15_000;

export class OpenAIProvider implements LLMProviderInterface {
    readonly name = 'OpenAI';
    private readonly apiKey: string;
    private readonly model: string;

    constructor(apiKey: string, model?: string) {
        this.apiKey = apiKey;
        this.model = model || DEFAULT_MODEL;
    }

    isConfigured(): boolean {
        return this.apiKey.length > 0;
    }

    async complete(
        systemPrompt: string,
        userPrompt: string,
        options?: LLMRequestOptions,
    ): Promise<string> {
        const temperature = options?.temperature ?? 0.3;
        const maxTokens = options?.maxTokens ?? 800;
        const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

        const response = await axios.post(
            OPENAI_API_URL,
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
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
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

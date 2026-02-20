/**
 * Anthropic API provider for the LaTeX Citation Assistant.
 *
 * Direct HTTP calls via axios to the Anthropic Messages API.
 * No SDK dependency required.
 */

import axios from 'axios';
import { LLMProviderInterface, LLMRequestOptions } from './provider';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_TIMEOUT_MS = 15_000;
const API_VERSION = '2023-06-01';

export class AnthropicProvider implements LLMProviderInterface {
    readonly name = 'Anthropic';
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
            ANTHROPIC_API_URL,
            {
                model: this.model,
                max_tokens: maxTokens,
                temperature,
                system: systemPrompt,
                messages: [
                    { role: 'user', content: userPrompt },
                ],
            },
            {
                headers: {
                    'x-api-key': this.apiKey,
                    'anthropic-version': API_VERSION,
                    'content-type': 'application/json',
                },
                timeout: timeoutMs,
            },
        );

        const content = response.data?.content;
        if (Array.isArray(content) && content.length > 0 && content[0].type === 'text') {
            return content[0].text;
        }

        throw new Error('Unexpected Anthropic API response format');
    }
}

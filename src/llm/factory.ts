/**
 * LLM provider factory for the LaTeX Citation Assistant.
 *
 * Creates the appropriate LLM provider based on extension configuration.
 */

import { LLMConfig } from '../types';
import { LLMProviderInterface } from './provider';
import { AnthropicProvider } from './anthropic';
import { OpenAIProvider } from './openai';

/**
 * Create an LLM provider from the extension configuration.
 *
 * @param config - The LLM configuration block from settings.
 * @returns A configured provider, or null if LLM is disabled or unconfigured.
 */
export function createLLMProvider(config: LLMConfig): LLMProviderInterface | null {
    if (!config.enabled) {
        return null;
    }

    const model = config.model || undefined;
    const baseUrl = (config.baseUrl || '').trim();

    switch (config.provider) {
        case 'anthropic':
            return config.apiKey ? new AnthropicProvider(config.apiKey, model) : null;
        case 'openai':
            // A local OpenAI-compatible server (baseUrl set) may need no key.
            return (config.apiKey || baseUrl) ? new OpenAIProvider(config.apiKey, model, baseUrl) : null;
        default:
            return null;
    }
}

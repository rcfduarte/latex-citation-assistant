/**
 * Extension configuration reader for the LaTeX Citation Assistant.
 *
 * Reads flat VS Code settings from `latexCite.*` and maps them into the
 * strongly-typed {@link ExtensionConfig} structure used throughout the
 * extension. This centralizes all configuration access so that individual
 * modules never read from `vscode.workspace` directly.
 *
 * @module utils/config
 */

import * as vscode from 'vscode';
import { ExtensionConfig, LLMProvider } from '../types';

/**
 * Read the current extension configuration and return a typed object.
 *
 * The VS Code settings are flat keys under the `latexCite` namespace
 * (e.g. `latexCite.zotero.enabled`). This function maps them into the
 * nested {@link ExtensionConfig} interface expected by the rest of the
 * codebase.
 *
 * Call this function whenever you need a fresh snapshot of the settings;
 * the result is not cached, so workspace-level overrides and live edits
 * are picked up immediately.
 *
 * @returns A fully populated {@link ExtensionConfig} with defaults for any
 *          missing values.
 *
 * @example
 * ```ts
 * import { getConfig } from './utils/config';
 *
 * const cfg = getConfig();
 * if (cfg.zotero.enabled && cfg.zotero.apiKey) {
 *     // initialise Zotero source
 * }
 * ```
 */
export function getConfig(): ExtensionConfig {
    const cfg = vscode.workspace.getConfiguration('latexCite');

    return {
        zotero: {
            enabled: cfg.get<boolean>('zotero.enabled', true),
            apiKey: cfg.get<string>('zotero.apiKey', ''),
            userId: cfg.get<string>('zotero.userId', ''),
        },
        semanticScholar: {
            enabled: cfg.get<boolean>('semanticScholar.enabled', true),
            apiKey: cfg.get<string>('semanticScholar.apiKey', ''),
        },
        maxResults: cfg.get<number>('maxResults', 20),
        contextSentences: cfg.get<number>('contextSentences', 2),
        suggestionsBibFile: cfg.get<string>('suggestionsBibFile', 'suggestions.bib'),
        citationCommand: cfg.get<string>('citationCommand', '\\cite'),
        excludeCited: cfg.get<boolean>('excludeCited', true),
        llm: {
            enabled: cfg.get<boolean>('llm.enabled', false),
            provider: cfg.get<LLMProvider>('llm.provider', 'anthropic'),
            apiKey: cfg.get<string>('llm.apiKey', ''),
            model: cfg.get<string>('llm.model', ''),
            baseUrl: cfg.get<string>('llm.baseUrl', ''),
        },
    };
}

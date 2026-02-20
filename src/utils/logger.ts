/**
 * Logging utility for the LaTeX Citation Assistant.
 *
 * Wraps a VS Code {@link vscode.OutputChannel} named "LaTeX Citations" and
 * provides timestamped, level-prefixed logging. A singleton instance is
 * managed via {@link getLogger} so that every module writes to the same
 * output channel without having to pass a logger reference around.
 *
 * @module utils/logger
 */

import * as vscode from 'vscode';

/**
 * Logger that writes to a dedicated VS Code output channel.
 *
 * Each message is prefixed with an ISO-8601 timestamp and an optional
 * severity tag ([WARN], [ERROR], [DEBUG]). Info-level messages carry no
 * tag beyond the timestamp, keeping the output concise for the common
 * case.
 */
export class Logger {
    private channel: vscode.OutputChannel;

    /**
     * Create a new Logger backed by the given output channel.
     *
     * @param channel - The VS Code output channel to write to.
     */
    constructor(channel: vscode.OutputChannel) {
        this.channel = channel;
    }

    /**
     * Log an informational message.
     *
     * @param message - The message to log.
     */
    info(message: string): void {
        this.channel.appendLine(`${this.timestamp()} ${message}`);
    }

    /**
     * Log a warning message with [WARN] prefix.
     *
     * @param message - The message to log.
     */
    warn(message: string): void {
        this.channel.appendLine(`${this.timestamp()} [WARN] ${message}`);
    }

    /**
     * Log an error message with [ERROR] prefix.
     *
     * @param message - The message to log.
     */
    error(message: string): void {
        this.channel.appendLine(`${this.timestamp()} [ERROR] ${message}`);
    }

    /**
     * Log a debug message with [DEBUG] prefix.
     *
     * @param message - The message to log.
     */
    debug(message: string): void {
        this.channel.appendLine(`${this.timestamp()} [DEBUG] ${message}`);
    }

    /**
     * Reveal the output channel in the VS Code UI.
     *
     * Useful for drawing the user's attention to diagnostic information,
     * for example after the "Analyze Context" command.
     */
    show(): void {
        this.channel.show(true);
    }

    /**
     * Dispose the underlying output channel.
     *
     * Call this from the extension's `deactivate` or via the
     * `ExtensionContext.subscriptions` disposal chain.
     */
    dispose(): void {
        this.channel.dispose();
    }

    /**
     * Generate an ISO-8601 timestamp string for the current instant.
     *
     * @returns A formatted timestamp, e.g. `[2026-02-16T14:30:05.123Z]`.
     */
    private timestamp(): string {
        return `[${new Date().toISOString()}]`;
    }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let instance: Logger | undefined;

/**
 * Get or create the singleton Logger instance.
 *
 * On the first call this creates a VS Code output channel named
 * "LaTeX Citations". Subsequent calls return the same instance.
 *
 * @returns The shared {@link Logger} instance.
 *
 * @example
 * ```ts
 * import { getLogger } from './utils/logger';
 *
 * const log = getLogger();
 * log.info('Extension activated');
 * log.debug(`Config loaded: ${JSON.stringify(cfg)}`);
 * ```
 */
export function getLogger(): Logger {
    if (!instance) {
        const channel = vscode.window.createOutputChannel('LaTeX Citations');
        instance = new Logger(channel);
    }
    return instance;
}

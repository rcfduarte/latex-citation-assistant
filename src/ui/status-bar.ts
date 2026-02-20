/**
 * Status bar management for the LaTeX Citation Assistant.
 *
 * Provides a single status bar item at the bottom of the VS Code window
 * that reflects the current state of the extension: ready, busy
 * (searching), error, or showing result counts from the last search.
 *
 * @module ui/status-bar
 */

import * as vscode from 'vscode';

/**
 * Manages a VS Code status bar item that shows the extension state.
 *
 * The item is positioned at `StatusBarAlignment.Right` with a high
 * priority so it appears near the right edge alongside other language
 * tools. Clicking it triggers the main `latex-cite.suggest` command.
 *
 * @example
 * ```ts
 * const bar = new StatusBarManager();
 * bar.showReady();
 *
 * bar.showBusy('Searching...');
 * const results = await engine.search(request);
 * bar.showResults(zoteroCount, s2Count);
 *
 * context.subscriptions.push(bar);
 * ```
 */
export class StatusBarManager implements vscode.Disposable {
    private item: vscode.StatusBarItem;

    constructor() {
        this.item = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100,
        );
        this.item.command = 'latex-cite.suggest';
        this.showReady();
    }

    /**
     * Show a spinning animation with a custom message.
     *
     * Used while a search is in progress.
     *
     * @param message - Short description of the ongoing operation
     *                  (e.g. "Searching...").
     */
    showBusy(message: string): void {
        this.item.text = `$(sync~spin) ${message}`;
        this.item.tooltip = 'LaTeX Citation Assistant - searching...';
        this.item.show();
    }

    /**
     * Show the idle/ready state.
     *
     * Displays a search icon with "Citations" to indicate that the
     * extension is active and waiting for a command invocation.
     */
    showReady(): void {
        this.item.text = '$(search) Citations';
        this.item.tooltip = 'LaTeX Citation Assistant - click to suggest citations';
        this.item.show();
    }

    /**
     * Show an error state with a message.
     *
     * @param message - A brief error description.
     */
    showError(message: string): void {
        this.item.text = `$(error) ${message}`;
        this.item.tooltip = 'LaTeX Citation Assistant - error occurred';
        this.item.show();
    }

    /**
     * Show result counts from the last search.
     *
     * Displays the number of results from each source so the user can
     * see at a glance how many suggestions were found.
     *
     * @param zoteroCount - Number of results from Zotero.
     * @param s2Count     - Number of results from Semantic Scholar.
     */
    showResults(zoteroCount: number, s2Count: number): void {
        this.item.text = `$(check) Z:${zoteroCount} S2:${s2Count}`;
        this.item.tooltip =
            `LaTeX Citation Assistant - last search: ` +
            `${zoteroCount} Zotero, ${s2Count} Semantic Scholar`;
        this.item.show();
    }

    /**
     * Make the status bar item visible.
     */
    show(): void {
        this.item.show();
    }

    /**
     * Hide the status bar item without disposing it.
     */
    hide(): void {
        this.item.hide();
    }

    /**
     * Dispose the status bar item.
     *
     * This is called automatically if the manager is added to
     * `ExtensionContext.subscriptions`.
     */
    dispose(): void {
        this.item.dispose();
    }
}

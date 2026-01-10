import { chromium, firefox, webkit, type Browser, type BrowserContext, type Page } from 'playwright';
import type { LaunchCommand } from './types.js';

/**
 * Manages the Playwright browser lifecycle with multiple tabs/windows
 */
export class BrowserManager {
  private browser: Browser | null = null;
  private contexts: BrowserContext[] = [];
  private pages: Page[] = [];
  private activePageIndex: number = 0;

  /**
   * Check if browser is launched
   */
  isLaunched(): boolean {
    return this.browser !== null;
  }

  /**
   * Get the current active page, throws if not launched
   */
  getPage(): Page {
    if (this.pages.length === 0) {
      throw new Error('Browser not launched. Call launch first.');
    }
    return this.pages[this.activePageIndex];
  }

  /**
   * Get all pages
   */
  getPages(): Page[] {
    return this.pages;
  }

  /**
   * Get current page index
   */
  getActiveIndex(): number {
    return this.activePageIndex;
  }

  /**
   * Get the current browser instance
   */
  getBrowser(): Browser | null {
    return this.browser;
  }

  /**
   * Launch the browser with the specified options
   */
  async launch(options: LaunchCommand): Promise<void> {
    // Close existing browser if any
    if (this.browser) {
      await this.close();
    }

    // Select browser type
    const browserType = options.browser ?? 'chromium';
    const launcher = browserType === 'firefox' 
      ? firefox 
      : browserType === 'webkit' 
        ? webkit 
        : chromium;

    // Launch browser
    this.browser = await launcher.launch({
      headless: options.headless ?? true,
    });

    // Create context with viewport
    const context = await this.browser.newContext({
      viewport: options.viewport ?? { width: 1280, height: 720 },
    });
    this.contexts.push(context);

    // Create initial page
    const page = await context.newPage();
    this.pages.push(page);
    this.activePageIndex = 0;
  }

  /**
   * Create a new tab in the current context
   */
  async newTab(): Promise<{ index: number; total: number }> {
    if (!this.browser || this.contexts.length === 0) {
      throw new Error('Browser not launched');
    }

    const context = this.contexts[0]; // Use first context for tabs
    const page = await context.newPage();
    this.pages.push(page);
    this.activePageIndex = this.pages.length - 1;

    return { index: this.activePageIndex, total: this.pages.length };
  }

  /**
   * Create a new window (new context)
   */
  async newWindow(viewport?: { width: number; height: number }): Promise<{ index: number; total: number }> {
    if (!this.browser) {
      throw new Error('Browser not launched');
    }

    const context = await this.browser.newContext({
      viewport: viewport ?? { width: 1280, height: 720 },
    });
    this.contexts.push(context);

    const page = await context.newPage();
    this.pages.push(page);
    this.activePageIndex = this.pages.length - 1;

    return { index: this.activePageIndex, total: this.pages.length };
  }

  /**
   * Switch to a specific tab/page by index
   */
  switchTo(index: number): { index: number; url: string; title: string } {
    if (index < 0 || index >= this.pages.length) {
      throw new Error(`Invalid tab index: ${index}. Available: 0-${this.pages.length - 1}`);
    }

    this.activePageIndex = index;
    const page = this.pages[index];

    return {
      index: this.activePageIndex,
      url: page.url(),
      title: '', // Title requires async, will be fetched separately
    };
  }

  /**
   * Close a specific tab/page
   */
  async closeTab(index?: number): Promise<{ closed: number; remaining: number }> {
    const targetIndex = index ?? this.activePageIndex;

    if (targetIndex < 0 || targetIndex >= this.pages.length) {
      throw new Error(`Invalid tab index: ${targetIndex}`);
    }

    if (this.pages.length === 1) {
      throw new Error('Cannot close the last tab. Use "close" to close the browser.');
    }

    const page = this.pages[targetIndex];
    await page.close();
    this.pages.splice(targetIndex, 1);

    // Adjust active index if needed
    if (this.activePageIndex >= this.pages.length) {
      this.activePageIndex = this.pages.length - 1;
    } else if (this.activePageIndex > targetIndex) {
      this.activePageIndex--;
    }

    return { closed: targetIndex, remaining: this.pages.length };
  }

  /**
   * List all tabs with their info
   */
  async listTabs(): Promise<Array<{ index: number; url: string; title: string; active: boolean }>> {
    const tabs = await Promise.all(
      this.pages.map(async (page, index) => ({
        index,
        url: page.url(),
        title: await page.title().catch(() => ''),
        active: index === this.activePageIndex,
      }))
    );
    return tabs;
  }

  /**
   * Close the browser and clean up
   */
  async close(): Promise<void> {
    for (const page of this.pages) {
      await page.close().catch(() => {});
    }
    this.pages = [];

    for (const context of this.contexts) {
      await context.close().catch(() => {});
    }
    this.contexts = [];

    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }

    this.activePageIndex = 0;
  }
}

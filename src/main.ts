import { Plugin } from 'obsidian';
import {
  DEFAULT_SETTINGS,
  JustVerticalTabsSettingTab,
  type JustVerticalTabsSettings,
  type TabBarSide,
} from './settings';

const TOGGLE_SELECTOR = '.mod-root .workspace-tab-header-container > .sidebar-toggle-button.mod-right';
const VIEW_ACTIONS_SELECTOR = '.mod-root .workspace-leaf.mod-active .view-actions';

export default class JustVerticalTabsPlugin extends Plugin {
  settings: JustVerticalTabsSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    document.body.classList.add('jvt-active');
    this.applySettings();

    this.addSettingTab(new JustVerticalTabsSettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        if (this.settings.moveToggleToHeader) {
          this.moveToggleToHeader();
        }
      })
    );
  }

  onunload(): void {
    this.restoreToggle();
    document.body.classList.remove('jvt-active', 'jvt-side-left', 'jvt-side-right');
  }

  async loadSettings(): Promise<void> {
    const loadedData = (await this.loadData()) as Partial<JustVerticalTabsSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loadedData,
      side: this.normalizeSide(loadedData?.side),
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.applySettings();
  }

  async updateSide(side: string): Promise<void> {
    this.settings.side = this.normalizeSide(side);
    await this.saveSettings();
  }

  private normalizeSide(side: string | undefined): TabBarSide {
    return side === 'left' ? 'left' : 'right';
  }

  private applySettings(): void {
    document.body.classList.remove('jvt-side-left', 'jvt-side-right');
    document.body.classList.add(`jvt-side-${this.settings.side}`);

    if (this.settings.moveToggleToHeader) {
      this.moveToggleToHeader();
    } else {
      this.restoreToggle();
    }
  }

  /** Move the sidebar toggle button into the active leaf's view-actions bar. */
  private moveToggleToHeader(): void {
    const toggle = document.querySelector<HTMLElement>(TOGGLE_SELECTOR)
      ?? document.querySelector<HTMLElement>('.view-actions > .sidebar-toggle-button.mod-right');

    if (!toggle) return;

    const viewActions = document.querySelector<HTMLElement>(VIEW_ACTIONS_SELECTOR);
    if (!viewActions || toggle.parentElement === viewActions) return;

    viewActions.insertBefore(toggle, viewActions.firstChild);
  }

  /** Move the sidebar toggle button back into the tab header container. */
  private restoreToggle(): void {
    const toggle = document.querySelector<HTMLElement>('.sidebar-toggle-button.mod-right');
    if (!toggle) return;

    const tabContainer = document.querySelector<HTMLElement>(
      '.mod-root .workspace-tab-header-container'
    );
    if (!tabContainer || toggle.parentElement === tabContainer) return;

    tabContainer.appendChild(toggle);
  }
}

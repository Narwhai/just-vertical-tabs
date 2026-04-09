import { Plugin, setIcon } from 'obsidian';
import {
  DEFAULT_SETTINGS,
  JustVerticalTabsSettingTab,
  type JustVerticalTabsSettings,
  type SidebarTogglePlacement,
  type TabBarSide,
} from './settings';

const TAB_HEADER_CONTAINER_SELECTOR = '.mod-root .workspace-tab-header-container';
const TAB_HEADER_INNER_SELECTOR = '.mod-root .workspace-tab-header-inner';
const VIEW_ACTIONS_SELECTOR = '.mod-root .workspace-leaf.mod-active .view-actions';
const TOGGLE_SELECTOR = '.sidebar-toggle-button.mod-right';
const WORKSPACE_ROOT_SELECTOR = '.mod-root';
const COLLAPSE_BUTTON_SELECTOR = '.jvt-collapse-tab-bar-button';

type LoadedSettings = Partial<JustVerticalTabsSettings> & {
  sidebarTogglePlacement?: SidebarTogglePlacement | 'bottom';
  moveToggleToHeader?: boolean;
};

export default class JustVerticalTabsPlugin extends Plugin {
  settings: JustVerticalTabsSettings = DEFAULT_SETTINGS;
  togglePlacementTimeouts: number[] = [];
  collapsedLabelSyncTimeout: number | null = null;
  tabLabelObserver: MutationObserver | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    document.body.classList.add('jvt-active');
    this.applySettings();

    this.addSettingTab(new JustVerticalTabsSettingTab(this.app, this));

    this.addCommand({
      id: 'toggle-collapse-tab-bar',
      name: 'Toggle collapsed tab bar',
      callback: async () => this.toggleCollapseTabBar(),
    });

    this.ensureTabLabelObserver();
    this.scheduleCollapsedLabelSync();

    this.registerDomEvent(document, 'click', (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(TOGGLE_SELECTOR)) {
        this.scheduleTogglePlacement();
      }
    });

    this.registerDomEvent(document, 'transitionend', (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.workspace-split.mod-right-split')) {
        this.scheduleTogglePlacement();
      }
    });

    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.ensureTabLabelObserver();
        this.scheduleTogglePlacement();
        this.scheduleCollapsedLabelSync();
      })
    );
  }

  onunload(): void {
    this.clearTogglePlacementTimeouts();
    this.clearCollapsedLabelSyncTimeout();
    this.disconnectTabLabelObserver();

    this.restoreToggle();
    this.removeCollapseButton();
    document.body.classList.remove(
      'jvt-active',
      'jvt-collapse-tab-bar',
      'jvt-hide-tab-icons',
      'jvt-side-left',
      'jvt-side-right',
      'jvt-sidebar-toggle-bottom'
    );
  }

  async loadSettings(): Promise<void> {
    const loadedData = (await this.loadData()) as LoadedSettings | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loadedData,
      side: this.normalizeSide(loadedData?.side),
      sidebarTogglePlacement: this.normalizeSidebarTogglePlacement(loadedData),
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

  async toggleCollapseTabBar(): Promise<void> {
    this.settings.collapseTabBar = !this.settings.collapseTabBar;
    await this.saveSettings();
  }

  private normalizeSide(side: string | undefined): TabBarSide {
    return side === 'left' ? 'left' : 'right';
  }

  private normalizeSidebarTogglePlacement(
    loadedData: LoadedSettings | null | undefined
  ): SidebarTogglePlacement {
    if (loadedData?.sidebarTogglePlacement === 'bottom') {
      return 'bottom';
    }

    if (loadedData?.moveToggleToHeader === true) {
      return 'header';
    }

    if (loadedData?.moveToggleToHeader === false) {
      return 'bottom';
    }

    return this.normalizeSidebarTogglePlacementValue(loadedData?.sidebarTogglePlacement);
  }

  normalizeSidebarTogglePlacementValue(
    placement: string | SidebarTogglePlacement | undefined
  ): SidebarTogglePlacement {
    if (placement === 'header') {
      return 'header';
    }

    if (placement === 'bottom') {
      return 'bottom';
    }

    return 'default';
  }

  private applySettings(): void {
    document.body.classList.remove('jvt-side-left', 'jvt-side-right');
    document.body.classList.add(`jvt-side-${this.settings.side}`);
    document.body.classList.toggle('jvt-collapse-tab-bar', this.settings.collapseTabBar);
    document.body.classList.toggle('jvt-hide-tab-icons', !this.settings.showTabIcons);
    document.body.classList.toggle(
      'jvt-sidebar-toggle-bottom',
      this.settings.sidebarTogglePlacement === 'bottom'
    );

    this.scheduleTogglePlacement();
    this.scheduleCollapsedLabelSync();
  }

  private scheduleTogglePlacement(): void {
    this.applyTogglePlacement();

    this.clearTogglePlacementTimeouts();

    for (const delay of [75, 250, 500, 1000, 1500]) {
      const timeoutId = window.setTimeout(() => {
        this.togglePlacementTimeouts = this.togglePlacementTimeouts.filter((id) => id !== timeoutId);
        this.applyTogglePlacement();
      }, delay);

      this.togglePlacementTimeouts.push(timeoutId);
    }
  }

  private clearTogglePlacementTimeouts(): void {
    for (const timeoutId of this.togglePlacementTimeouts) {
      window.clearTimeout(timeoutId);
    }

    this.togglePlacementTimeouts = [];
  }

  private ensureTabLabelObserver(): void {
    if (this.tabLabelObserver) {
      return;
    }

    const workspaceRoot = document.querySelector<HTMLElement>(WORKSPACE_ROOT_SELECTOR);
    if (!workspaceRoot) {
      return;
    }

    this.tabLabelObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData' || mutation.type === 'childList') {
          this.scheduleCollapsedLabelSync();
          return;
        }
      }
    });

    this.tabLabelObserver.observe(workspaceRoot, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }

  private disconnectTabLabelObserver(): void {
    this.tabLabelObserver?.disconnect();
    this.tabLabelObserver = null;
  }

  private scheduleCollapsedLabelSync(): void {
    if (this.collapsedLabelSyncTimeout !== null) {
      return;
    }

    this.collapsedLabelSyncTimeout = window.setTimeout(() => {
      this.collapsedLabelSyncTimeout = null;
      this.syncCollapsedLabels();
    }, 16);
  }

  private clearCollapsedLabelSyncTimeout(): void {
    if (this.collapsedLabelSyncTimeout === null) {
      return;
    }

    window.clearTimeout(this.collapsedLabelSyncTimeout);
    this.collapsedLabelSyncTimeout = null;
  }

  private syncCollapsedLabels(): void {
    const tabHeaderInners = Array.from(
      document.querySelectorAll<HTMLElement>(TAB_HEADER_INNER_SELECTOR)
    );

    for (const innerEl of tabHeaderInners) {
      const titleEl = innerEl.querySelector<HTMLElement>('.workspace-tab-header-inner-title');
      const rawTitle = titleEl?.textContent ?? innerEl.getAttribute('aria-label') ?? '';
      innerEl.dataset.jvtCollapsedLabel = this.getCollapsedLabel(rawTitle);
    }
  }

  private getCollapsedLabel(rawTitle: string): string {
    const normalizedTitle = rawTitle.replace(/\s+/g, ' ').trim();
    if (!normalizedTitle) {
      return '?';
    }

    const words = normalizedTitle.split(' ').filter(Boolean);
    if (words.length >= 2) {
      const initials = words
        .slice(0, 2)
        .map((word) => Array.from(word)[0] ?? '')
        .join('');

      if (initials) {
        return initials.toUpperCase();
      }
    }

    return (Array.from(words[0] ?? normalizedTitle)[0] ?? '?').toUpperCase();
  }

  private applyTogglePlacement(): void {
    if (
      this.settings.sidebarTogglePlacement === 'header'
      || !this.settings.showCollapseTabBarButton
    ) {
      this.removeCollapseButton();
      if (this.settings.sidebarTogglePlacement === 'header') {
        this.moveToggleToHeader();
      }
      return;
    }

    this.restoreToggle();
    this.ensureCollapseButton();
  }

  private ensureCollapseButton(): void {
    const tabContainer = document.querySelector<HTMLElement>(TAB_HEADER_CONTAINER_SELECTOR);
    const toggle = document.querySelector<HTMLElement>(TOGGLE_SELECTOR);

    if (!tabContainer || !toggle || toggle.parentElement !== tabContainer) {
      this.removeCollapseButton();
      return;
    }

    let button = tabContainer.querySelector<HTMLElement>(COLLAPSE_BUTTON_SELECTOR);
    if (!button) {
      const createdButton = document.createElement('button');
      createdButton.type = 'button';
      createdButton.className = 'clickable-icon jvt-collapse-tab-bar-button';
      createdButton.addEventListener('click', () => {
        void this.toggleCollapseTabBar();
      });
      button = createdButton;
    }

    this.updateCollapseButton(button);

    if (button.parentElement !== tabContainer || button.nextElementSibling !== toggle) {
      tabContainer.insertBefore(button, toggle);
    }
  }

  private updateCollapseButton(button: HTMLElement): void {
    const actionLabel = this.settings.collapseTabBar ? 'Expand tab bar' : 'Collapse tab bar';

    button.setAttribute('aria-label', actionLabel);
    button.setAttribute('title', actionLabel);
    button.setAttribute('data-tooltip-position', this.settings.side === 'right' ? 'left' : 'right');
    button.classList.toggle('is-collapsed', this.settings.collapseTabBar);

    setIcon(button, this.getCollapseButtonIcon());
  }

  private getCollapseButtonIcon(): string {
    if (this.settings.side === 'left') {
      return this.settings.collapseTabBar ? 'chevrons-right' : 'chevrons-left';
    }

    return this.settings.collapseTabBar ? 'chevrons-left' : 'chevrons-right';
  }

  private removeCollapseButton(): void {
    document.querySelector<HTMLElement>(COLLAPSE_BUTTON_SELECTOR)?.remove();
  }

  /** Place the right sidebar toggle in the active note header after More options. */
  private moveToggleToHeader(): void {
    const toggle = document.querySelector<HTMLElement>(TOGGLE_SELECTOR);
    const viewActions = document.querySelector<HTMLElement>(VIEW_ACTIONS_SELECTOR);

    if (!toggle || !viewActions) {
      return;
    }

    const moreOptionsButton = Array.from(viewActions.children).find((child) =>
      child.querySelector?.('.lucide-more-vertical')
    );

    if (moreOptionsButton) {
      if (
        toggle.parentElement === viewActions
        && moreOptionsButton.nextElementSibling === toggle
      ) {
        return;
      }

      viewActions.insertBefore(toggle, moreOptionsButton.nextSibling);
      return;
    }

    if (toggle.parentElement === viewActions && viewActions.lastElementChild === toggle) {
      return;
    }

    viewActions.appendChild(toggle);
  }

  /** Move the sidebar toggle button back into the tab header container. */
  private restoreToggle(): void {
    const toggle = document.querySelector<HTMLElement>(TOGGLE_SELECTOR);
    const tabContainer = document.querySelector<HTMLElement>(TAB_HEADER_CONTAINER_SELECTOR);

    if (!toggle || !tabContainer || toggle.parentElement === tabContainer) {
      return;
    }

    tabContainer.appendChild(toggle);
  }
}

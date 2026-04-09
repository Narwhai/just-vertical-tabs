import { Plugin } from 'obsidian';
import {
  DEFAULT_SETTINGS,
  JustVerticalTabsSettingTab,
  type JustVerticalTabsSettings,
  type SidebarTogglePlacement,
  type TabBarSide,
} from './settings';

const TAB_HEADER_CONTAINER_SELECTOR = '.mod-root .workspace-tab-header-container';
const VIEW_ACTIONS_SELECTOR = '.mod-root .workspace-leaf.mod-active .view-actions';
const TOGGLE_SELECTOR = '.sidebar-toggle-button.mod-right';

type LoadedSettings = Partial<JustVerticalTabsSettings> & {
  sidebarTogglePlacement?: SidebarTogglePlacement | 'bottom';
  moveToggleToHeader?: boolean;
};

export default class JustVerticalTabsPlugin extends Plugin {
  settings: JustVerticalTabsSettings = DEFAULT_SETTINGS;
  togglePlacementTimeouts: number[] = [];

  async onload(): Promise<void> {
    await this.loadSettings();

    document.body.classList.add('jvt-active');
    this.applySettings();

    this.addSettingTab(new JustVerticalTabsSettingTab(this.app, this));

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
        this.scheduleTogglePlacement();
      })
    );
  }

  onunload(): void {
    this.clearTogglePlacementTimeouts();

    this.restoreToggle();
    document.body.classList.remove(
      'jvt-active',
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
    document.body.classList.toggle('jvt-hide-tab-icons', !this.settings.showTabIcons);
    document.body.classList.toggle(
      'jvt-sidebar-toggle-bottom',
      this.settings.sidebarTogglePlacement === 'bottom'
    );

    this.scheduleTogglePlacement();
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

  private applyTogglePlacement(): void {
    if (this.settings.sidebarTogglePlacement === 'header') {
      this.moveToggleToHeader();
      return;
    }

    this.restoreToggle();
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

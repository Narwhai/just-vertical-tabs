import { Plugin, debounce, setIcon, type Debouncer } from 'obsidian';
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
const COLLAPSE_BUTTON_SELECTOR = '.jvt-collapse-tab-bar-button';

/** Throttle interval for dragover position tracking (ms). */
const DRAG_THROTTLE_MS = 16;

type LoadedSettings = Partial<JustVerticalTabsSettings> & {
  sidebarTogglePlacement?: SidebarTogglePlacement | 'bottom';
  moveToggleToHeader?: boolean;
};

type DragPosition = {
  x: number;
  y: number;
};

type DragLikeEvent = {
  clientX: number;
  clientY: number;
};

type TabInsertLocation = {
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  index: number;
  droppedIndex: number | null;
};

type TabLeafLike = {
  tabHeaderEl: HTMLElement;
};

type TabGroupLike = {
  children: TabLeafLike[];
  tabHeaderContainerEl: HTMLElement;
  getTabInsertLocation: (clientX: number) => TabInsertLocation;
};

type WorkspaceLike = {
  activeLeaf?: {
    parent?: unknown;
  } | null;
  rootSplit?: unknown;
  getDropDirection: (
    event: DragLikeEvent,
    rect: DOMRect,
    directions: string[] | null | undefined,
    target: unknown
  ) => string;
};

export default class JustVerticalTabsPlugin extends Plugin {
  settings: JustVerticalTabsSettings = DEFAULT_SETTINGS;
  tabLabelObserver: MutationObserver | null = null;
  /** The element currently being observed by tabLabelObserver. */
  tabLabelObserverTarget: HTMLElement | null = null;
  lastDragPosition: DragPosition | null = null;
  /** Timestamp of the last accepted dragover position update (for throttling). */
  lastDragUpdateTime = 0;
  patchedTabGroupPrototype: Record<string, unknown> | null = null;
  originalGetTabInsertLocation: ((this: TabGroupLike, clientX: number) => TabInsertLocation) | null = null;
  patchedWorkspacePrototype: Record<string, unknown> | null = null;
  originalGetDropDirection:
    | ((
      this: WorkspaceLike,
      event: DragLikeEvent,
      rect: DOMRect,
      directions: string[] | null | undefined,
      target: unknown
    ) => string)
    | null = null;
  /** Cached vertical-mode state, updated on settings change. */
  isVerticalActive = false;
  /** Bound handler for the collapse button click, stored for cleanup. */
  private readonly collapseButtonClickHandler = (): void => {
    void this.toggleCollapseTabBar();
  };

  /**
   * Debounced toggle placement — replaces the 5-timeout waterfall.
   * Leading edge ensures immediate first call; trailing edge catches
   * animations that settle later. 500 ms covers Obsidian sidebar animations.
   */
  private readonly debouncedTogglePlacement: Debouncer<[], void> = debounce(
    () => this.applyTogglePlacement(),
    500,
    true,
  );

  /** Debounced collapsed-label sync (16 ms, leading). */
  private readonly debouncedCollapsedLabelSync: Debouncer<[], void> = debounce(
    () => this.syncCollapsedLabels(),
    16,
    true,
  );

  /** Debounced layout-change handler to coalesce rapid-fire events (50 ms). */
  private readonly debouncedLayoutChange: Debouncer<[], void> = debounce(
    () => this.handleLayoutChange(),
    50,
    true,
  );

  async onload(): Promise<void> {
    await this.loadSettings();

    document.body.classList.add('jvt-active');
    this.isVerticalActive = true;
    this.applySettings();

    this.addSettingTab(new JustVerticalTabsSettingTab(this.app, this));

    this.addCommand({
      id: 'toggle-collapse-tab-bar',
      name: 'Toggle collapsed tab bar',
      callback: async () => this.toggleCollapseTabBar(),
    });

    this.ensureTabLabelObserver();
    this.registerDragTracking();
    this.patchWorkspaceDragBehavior();
    this.debouncedCollapsedLabelSync();

    this.registerDomEvent(document, 'click', (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(TOGGLE_SELECTOR)) {
        this.debouncedTogglePlacement();
      }
    });

    this.registerDomEvent(document, 'transitionend', (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.workspace-split.mod-right-split')) {
        this.debouncedTogglePlacement();
      }
    });

    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.debouncedLayoutChange();
      })
    );

    // Cancel all debouncers on unload.
    this.register(() => this.debouncedTogglePlacement.cancel());
    this.register(() => this.debouncedCollapsedLabelSync.cancel());
    this.register(() => this.debouncedLayoutChange.cancel());
  }

  onunload(): void {
    this.disconnectTabLabelObserver();
    this.restoreWorkspaceDragBehavior();
    this.lastDragPosition = null;
    this.isVerticalActive = false;

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
    placement: string | undefined
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

    this.isVerticalActive = document.body.classList.contains('jvt-active');

    this.debouncedTogglePlacement();
    this.debouncedCollapsedLabelSync();
  }

  /** Coalesced handler for workspace layout-change events. */
  private handleLayoutChange(): void {
    this.ensureTabLabelObserver();
    this.patchWorkspaceDragBehavior();
    this.debouncedTogglePlacement();
    this.debouncedCollapsedLabelSync();
  }

  private registerDragTracking(): void {
    const updateDragPosition = (event: DragEvent): void => {
      const now = performance.now();
      if (now - this.lastDragUpdateTime < DRAG_THROTTLE_MS) {
        return;
      }
      this.lastDragUpdateTime = now;
      this.lastDragPosition = {
        x: event.clientX,
        y: event.clientY,
      };
    };

    const clearDragPosition = (): void => {
      this.lastDragPosition = null;
    };

    // Always capture the latest position on drop so insert location is accurate.
    const updateDragPositionOnDrop = (event: DragEvent): void => {
      this.lastDragPosition = {
        x: event.clientX,
        y: event.clientY,
      };
    };

    window.addEventListener('dragover', updateDragPosition, true);
    window.addEventListener('drop', updateDragPositionOnDrop, true);
    window.addEventListener('dragend', clearDragPosition, true);

    this.register(() => {
      window.removeEventListener('dragover', updateDragPosition, true);
      window.removeEventListener('drop', updateDragPositionOnDrop, true);
      window.removeEventListener('dragend', clearDragPosition, true);
    });
  }

  private patchWorkspaceDragBehavior(): void {
    this.patchTabGroupPrototype();
    this.patchWorkspacePrototype();
  }

  private restoreWorkspaceDragBehavior(): void {
    this.restoreTabGroupPrototype();
    this.restoreWorkspacePrototype();
  }

  private patchTabGroupPrototype(): void {
    const tabGroup = this.findTabGroup();
    if (!tabGroup) {
      return;
    }

    const prototype = Object.getPrototypeOf(tabGroup) as Record<string, unknown> | null;
    const originalMethod = prototype?.getTabInsertLocation;
    if (!prototype || typeof originalMethod !== 'function') {
      return;
    }

    if (this.patchedTabGroupPrototype === prototype) {
      return;
    }

    this.restoreTabGroupPrototype();

    this.originalGetTabInsertLocation = originalMethod as (this: TabGroupLike, clientX: number) => TabInsertLocation;
    this.patchedTabGroupPrototype = prototype;

    const getPatchedTabInsertLocation = this.getPatchedTabInsertLocation.bind(this);
    prototype.getTabInsertLocation = function getTabInsertLocationPatched(this: TabGroupLike, clientX: number) {
      return getPatchedTabInsertLocation(this, clientX);
    };
  }

  private restoreTabGroupPrototype(): void {
    if (!this.patchedTabGroupPrototype || !this.originalGetTabInsertLocation) {
      return;
    }

    this.patchedTabGroupPrototype.getTabInsertLocation = this.originalGetTabInsertLocation;
    this.patchedTabGroupPrototype = null;
    this.originalGetTabInsertLocation = null;
  }

  private patchWorkspacePrototype(): void {
    const workspace = this.app.workspace as unknown as WorkspaceLike;
    const prototype = Object.getPrototypeOf(workspace) as Record<string, unknown> | null;
    const originalMethod = prototype?.getDropDirection;
    if (!prototype || typeof originalMethod !== 'function') {
      return;
    }

    if (this.patchedWorkspacePrototype === prototype) {
      return;
    }

    this.restoreWorkspacePrototype();

    this.originalGetDropDirection = originalMethod as (
      this: WorkspaceLike,
      event: DragLikeEvent,
      rect: DOMRect,
      directions: string[] | null | undefined,
      target: unknown
    ) => string;
    this.patchedWorkspacePrototype = prototype;

    const getPatchedDropDirection = this.getPatchedDropDirection.bind(this);
    prototype.getDropDirection = function getDropDirectionPatched(
      this: WorkspaceLike,
      event: DragLikeEvent,
      rect: DOMRect,
      directions: string[] | null | undefined,
      target: unknown
    ) {
      return getPatchedDropDirection(this, event, rect, directions, target);
    };
  }

  private restoreWorkspacePrototype(): void {
    if (!this.patchedWorkspacePrototype || !this.originalGetDropDirection) {
      return;
    }

    this.patchedWorkspacePrototype.getDropDirection = this.originalGetDropDirection;
    this.patchedWorkspacePrototype = null;
    this.originalGetDropDirection = null;
  }

  private getPatchedDropDirection(
    workspace: WorkspaceLike,
    event: DragLikeEvent,
    rect: DOMRect,
    directions: string[] | null | undefined,
    target: unknown
  ): string {
    if (
      this.isVerticalTabGroup(target)
      && this.isPointInsideElement(event.clientX, event.clientY, target.tabHeaderContainerEl)
    ) {
      return 'center';
    }

    return this.originalGetDropDirection?.call(workspace, event, rect, directions, target) ?? 'center';
  }

  private getPatchedTabInsertLocation(tabGroup: TabGroupLike, clientX: number): TabInsertLocation {
    if (!this.isVerticalTabGroup(tabGroup) || !this.lastDragPosition || !this.originalGetTabInsertLocation) {
      return this.originalGetTabInsertLocation?.call(tabGroup, clientX) ?? {
        rect: {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
        },
        index: 0,
        droppedIndex: null,
      };
    }

    return this.getVerticalTabInsertLocation(tabGroup, this.lastDragPosition.y);
  }

  private getVerticalTabInsertLocation(tabGroup: TabGroupLike, clientY: number): TabInsertLocation {
    const containerRect = tabGroup.tabHeaderContainerEl.getBoundingClientRect();
    const headers = tabGroup.children
      .map((child) => child.tabHeaderEl)
      .filter((headerEl): headerEl is HTMLElement => headerEl instanceof HTMLElement);

    if (headers.length === 0) {
      return {
        rect: {
          x: containerRect.x,
          y: containerRect.y - 5,
          width: containerRect.width,
          height: 10,
        },
        index: 0,
        droppedIndex: null,
      };
    }

    let insertRect = {
      x: containerRect.x,
      y: containerRect.bottom,
      width: containerRect.width,
      height: 10,
    };
    let insertIndex = headers.length;
    let droppedIndex: number | null = null;

    for (const [index, headerEl] of headers.entries()) {
      const headerRect = headerEl.getBoundingClientRect();
      const midpointY = (headerRect.top + headerRect.bottom) / 2;
      const isLastHeader = index === headers.length - 1;

      if (isLastHeader || clientY <= headerRect.bottom) {
        insertRect = {
          x: headerRect.x,
          y: headerRect.top,
          width: headerRect.width,
          height: 10,
        };
        insertIndex = index;

        const relativeDistance = Math.abs(clientY - midpointY) / Math.max(headerRect.height, 1);
        if (relativeDistance < 0.25) {
          droppedIndex = index;
        }

        if (clientY > midpointY) {
          insertIndex += 1;
          insertRect.y = headerRect.bottom;
        }

        break;
      }
    }

    insertRect.y -= 5;

    return {
      rect: insertRect,
      index: insertIndex,
      droppedIndex,
    };
  }

  private findTabGroup(): TabGroupLike | null {
    const workspace = this.app.workspace as unknown as WorkspaceLike;
    const activeLeafParent = workspace.activeLeaf?.parent;
    if (this.isTabGroupLike(activeLeafParent)) {
      return activeLeafParent;
    }

    return this.findTabGroupInNode(workspace.rootSplit);
  }

  private findTabGroupInNode(node: unknown): TabGroupLike | null {
    if (this.isTabGroupLike(node)) {
      return node;
    }

    const candidate = node as { children?: unknown[] } | null | undefined;
    if (!Array.isArray(candidate?.children)) {
      return null;
    }

    for (const child of candidate.children) {
      const tabGroup = this.findTabGroupInNode(child);
      if (tabGroup) {
        return tabGroup;
      }
    }

    return null;
  }

  private isTabGroupLike(value: unknown): value is TabGroupLike {
    const candidate = value as TabGroupLike | null | undefined;
    return !!candidate
      && Array.isArray(candidate.children)
      && candidate.tabHeaderContainerEl instanceof HTMLElement
      && typeof candidate.getTabInsertLocation === 'function';
  }

  /**
   * Check whether a value is a tab group rendered in vertical mode.
   * Uses the cached `isVerticalActive` flag instead of calling
   * `getComputedStyle` on every drag event.
   */
  private isVerticalTabGroup(value: unknown): value is TabGroupLike {
    return this.isTabGroupLike(value) && this.isVerticalActive;
  }

  private isPointInsideElement(clientX: number, clientY: number, element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    return clientX >= rect.left
      && clientX <= rect.right
      && clientY >= rect.top
      && clientY <= rect.bottom;
  }

  /**
   * Ensure a MutationObserver is watching all tab header containers for
   * label changes. Scoped narrowly to avoid firing on editor content changes.
   * Reconnects if the previously observed elements are no longer in the DOM.
   */
  private ensureTabLabelObserver(): void {
    const tabContainer = document.querySelector<HTMLElement>(TAB_HEADER_CONTAINER_SELECTOR);

    // If there's no container yet, clean up any stale observer.
    if (!tabContainer) {
      this.disconnectTabLabelObserver();
      return;
    }

    // If the observer target is still the same in-DOM element, keep it.
    if (
      this.tabLabelObserver
      && this.tabLabelObserverTarget === tabContainer
      && tabContainer.isConnected
    ) {
      return;
    }

    // Target changed or was removed — reconnect.
    this.disconnectTabLabelObserver();

    this.tabLabelObserver = new MutationObserver(() => {
      this.debouncedCollapsedLabelSync();
    });

    this.tabLabelObserver.observe(tabContainer, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    this.tabLabelObserverTarget = tabContainer;
  }

  private disconnectTabLabelObserver(): void {
    this.tabLabelObserver?.disconnect();
    this.tabLabelObserver = null;
    this.tabLabelObserverTarget = null;
  }

  /**
   * Sync collapsed labels on all tab headers.
   * Dirty-checks each label to avoid unnecessary DOM writes.
   */
  private syncCollapsedLabels(): void {
    const tabHeaderInners = Array.from(
      document.querySelectorAll<HTMLElement>(TAB_HEADER_INNER_SELECTOR)
    );

    for (const innerEl of tabHeaderInners) {
      const titleEl = innerEl.querySelector<HTMLElement>('.workspace-tab-header-inner-title');
      const rawTitle = titleEl?.textContent ?? innerEl.getAttribute('aria-label') ?? '';
      const newLabel = this.getCollapsedLabel(rawTitle);

      // Only write if the value actually changed.
      if (innerEl.dataset.jvtCollapsedLabel !== newLabel) {
        innerEl.dataset.jvtCollapsedLabel = newLabel;
      }
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
      createdButton.addEventListener('click', this.collapseButtonClickHandler);
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
    const button = document.querySelector<HTMLElement>(COLLAPSE_BUTTON_SELECTOR);
    if (button) {
      button.removeEventListener('click', this.collapseButtonClickHandler);
      button.remove();
    }
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

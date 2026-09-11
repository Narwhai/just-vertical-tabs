import type { App } from 'obsidian';
import type JustVerticalTabsPlugin from '../src/main';
import type { JustVerticalTabsSettings } from '../src/settings';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

/** Runs against the real Electron DOM/CSS; restores settings and workspace state. */
export async function runSidebarToggleTests(
  app: App,
  plugin: JustVerticalTabsPlugin,
): Promise<string[]> {
  const { workspace } = app;
  const doc = workspace.containerEl.ownerDocument;
  const win = workspace.rootSplit.win;
  const originalSettings = { ...plugin.settings };
  const originalCollapsed = workspace.rightSplit.collapsed;
  const originalHeaderShown = doc.body.classList.contains('show-view-header');
  const originalLeaf = workspace.getMostRecentLeaf(workspace.rootSplit);
  check(originalLeaf, 'Open a note in the main workspace before running these tests.');
  const originalActions = originalLeaf.view.containerEl.querySelector<HTMLElement>('.view-actions');
  check(originalActions, 'The active view must have note-header actions.');
  const passed: string[] = [];
  const wait = (ms: number): Promise<void> => new Promise((resolve) => win.setTimeout(resolve, ms));
  const configure = async (changes: Partial<JustVerticalTabsSettings>): Promise<void> => {
    plugin.settings = { ...originalSettings, ...changes };
    await plugin.saveSettings();
  };
  const customButton = (): HTMLButtonElement => {
    const buttons = doc.querySelectorAll<HTMLButtonElement>('.jvt-right-sidebar-toggle');
    check(buttons.length === 1 && buttons[0], 'Exactly one custom sidebar button must exist.');
    return buttons[0];
  };
  const nativeButtons = (): HTMLElement[] => Array.from(
    doc.querySelectorAll<HTMLElement>('.sidebar-toggle-button.mod-secondary'),
  );
  const checkState = (button: HTMLButtonElement): void => {
    const collapsed = workspace.rightSplit.collapsed;
    check(button.getAttribute('aria-expanded') === String(!collapsed), 'Expanded state is stale.');
    check(
      button.getAttribute('aria-label') === (collapsed ? 'Expand right sidebar' : 'Collapse right sidebar'),
      'Sidebar action label is stale.',
    );
    check(button.querySelector(collapsed ? '.lucide-panel-right-open' : '.lucide-panel-right-close'),
      'Sidebar icon does not match the action.');
  };
  const checkStableToggle = async (button: HTMLButtonElement): Promise<void> => {
    const host = button.parentElement;
    check(host, 'Custom button must be attached.');
    const rect = button.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    let removed = false;
    const observer = new MutationObserver((records) => {
      removed ||= records.some((record) => Array.from(record.removedNodes).includes(button));
    });
    observer.observe(host, { childList: true });
    try {
      for (let cycle = 0; cycle < 2; cycle++) {
        const before = workspace.rightSplit.collapsed;
        button.click();
        check(workspace.rightSplit.collapsed !== before, 'Click must toggle the sidebar exactly once.');
        checkState(button);
        for (const delay of [0, 16, 75, 250, 350]) {
          await wait(delay);
          const current = button.getBoundingClientRect();
          const currentHost = host.getBoundingClientRect();
          check(button === customButton() && button.parentElement === host && !removed,
            'The custom button was replaced or reparented during a sidebar animation.');
          check(Math.abs(current.y - currentHost.y - (rect.y - hostRect.y)) < 1,
            'Button moved vertically within its host.');
          check(Math.abs(current.x - currentHost.x - (rect.x - hostRect.x)) < 1,
            'Button moved horizontally within its host.');
          check(Math.abs(current.width - rect.width) < 1, 'Button width animated.');
          check(button.getAnimations({ subtree: true }).length === 0, 'Custom button animated.');
          check(nativeButtons().every((native) => !native.isShown()), 'A native button or clone flashed.');
          checkState(button);
        }
      }
    } finally {
      observer.disconnect();
    }
  };

  let extraAction: HTMLButtonElement | undefined;
  let splitLeaf: ReturnType<typeof workspace.createLeafBySplit> | undefined;
  try {
    doc.body.classList.add('show-view-header');
    const sides: JustVerticalTabsSettings['side'][] = ['left', 'right'];
    for (const side of sides) {
      for (const collapseTabBar of [false, true]) {
        for (const showCollapseTabBarButton of [false, true]) {
          await configure({ side, collapseTabBar, showCollapseTabBarButton, sidebarTogglePlacement: 'bottom' });
          const button = customButton();
          const host = button.parentElement;
          check(host && host.matches('.workspace-tab-header-container'), 'Bottom button is not in the tab bar.');
          check(Boolean(host.querySelector('.jvt-collapse-tab-bar-button')) === showCollapseTabBarButton,
            'Tab-bar collapse visibility must be independent of sidebar controls.');
          const hostStyles = win.getComputedStyle(host);
          const buttonStyles = win.getComputedStyle(button);
          const bottomSpace = host.getBoundingClientRect().bottom - button.getBoundingClientRect().bottom;
          check(Math.abs(bottomSpace - parseFloat(hostStyles.paddingBottom) - parseFloat(buttonStyles.marginBottom)) < 1,
            'Sidebar button must stay at the bottom even without the tab-bar collapse button.');
          await checkStableToggle(button);
          passed.push(`Bottom: ${side}, tab bar ${collapseTabBar ? 'collapsed' : 'expanded'}, collapse control ${showCollapseTabBarButton ? 'shown' : 'hidden'}`);
        }
      }
    }

    const probes = workspace.containerEl.createDiv();
    try {
      const legacy = probes.createDiv({ cls: 'sidebar-toggle-button mod-right' });
      const secondary = probes.createDiv({ cls: 'sidebar-toggle-button mod-secondary mod-left' });
      const primary = probes.createDiv({ cls: 'sidebar-toggle-button mod-primary mod-right' });
      check(win.getComputedStyle(legacy).display === 'none', 'Legacy native right-toggle markup must be hidden.');
      check(win.getComputedStyle(secondary).display === 'none', 'The secondary toggle must be hidden in RTL layouts.');
      check(win.getComputedStyle(primary).display !== 'none', 'The primary/left toggle must not be suppressed.');
      passed.push('Native suppression covers legacy markup without hiding the primary toggle in RTL');
    } finally {
      probes.remove();
    }

    // An action after More options catches accidental append-to-end placement.
    extraAction = originalActions.createEl('button', { text: 'Integration test action' });
    await configure({ sidebarTogglePlacement: 'header', showCollapseTabBarButton: true });
    const headerButton = customButton();
    const moreOptions = Array.from(originalActions.children).find((el) => el.querySelector('.lucide-more-vertical'));
    check(moreOptions?.nextElementSibling === headerButton, 'Header button must follow More options, not all actions.');
    check(!headerButton.hasAttribute('data-tooltip-position'), 'Header tooltip must not retain sideways placement.');
    check(doc.querySelector('.jvt-collapse-tab-bar-button'), 'Header placement must not remove the tab-bar collapse button.');
    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    check(!headerButton.dispatchEvent(mouseDown), 'Mouse activation should preserve editor focus.');
    await checkStableToggle(headerButton);
    passed.push('Header: placement after More options, tooltip, focus preservation, stable toggling');

    workspace.rightSplit.toggle();
    await wait(0);
    checkState(headerButton);
    passed.push('Sidebar state stays synchronized with external/API toggles');

    splitLeaf = workspace.createLeafBySplit(originalLeaf, 'vertical');
    await splitLeaf.setViewState({ type: 'empty', active: true });
    workspace.setActiveLeaf(splitLeaf, { focus: false });
    await wait(100);
    check(splitLeaf.view.containerEl.contains(customButton()), 'Header button must follow the active main-workspace split.');
    workspace.setActiveLeaf(originalLeaf, { focus: false });
    await wait(100);
    check(originalActions.contains(customButton()), 'Header button must return when switching tabs.');
    passed.push('Header follows main-workspace split/tab changes without duplicates');

    doc.body.classList.remove('show-view-header');
    await wait(0);
    check(!doc.querySelector('.jvt-right-sidebar-toggle'), 'No custom button should be left in a hidden header.');
    check(nativeButtons().some((button) => button.isShown()), 'Native control must remain available with a hidden header.');
    doc.body.classList.add('show-view-header');
    await wait(0);
    check(originalActions.contains(customButton()), 'Header control must return when the header is shown.');
    passed.push('Hidden header restores native control; showing it restores the custom control');

    await configure({ sidebarTogglePlacement: 'default', showCollapseTabBarButton: false });
    check(!doc.querySelector('.jvt-right-sidebar-toggle'), 'Native placement must remove custom controls.');
    check(!doc.body.classList.contains('jvt-custom-sidebar-toggle'), 'Native placement must remove suppression.');
    check(nativeButtons().some((button) => button.isShown()), 'Native toggle must be visible.');
    check(!doc.querySelector('.jvt-collapse-tab-bar-button'), 'Collapse button setting must work in native mode.');
    const native = nativeButtons()[0];
    check(native, 'Native sidebar control must exist.');
    const nativeParent = native.parentElement;
    await plugin.saveSettings();
    check(native.parentElement === nativeParent, 'Applying native placement must not reparent the native toggle.');
    passed.push('Header → native works with collapse control hidden; native ownership is preserved');
  } finally {
    extraAction?.remove();
    splitLeaf?.detach();
    workspace.setActiveLeaf(originalLeaf, { focus: false });
    doc.body.classList.toggle('show-view-header', originalHeaderShown);
    if (workspace.rightSplit.collapsed !== originalCollapsed) {
      workspace.rightSplit.toggle();
    }
    plugin.settings = originalSettings;
    await plugin.saveSettings();
  }
  return passed;
}

/** A queued settings write must not recreate controls after plugin unload. */
export async function runSidebarToggleLifecycleTest(
  app: App,
  plugin: JustVerticalTabsPlugin,
  unload: () => Promise<void>,
  load: () => Promise<void>,
): Promise<string> {
  const doc = app.workspace.containerEl.ownerDocument;
  const button = doc.querySelector<HTMLButtonElement>('.jvt-right-sidebar-toggle');
  const collapsed = app.workspace.rightSplit.collapsed;
  const saveData = plugin.saveData.bind(plugin);
  let release: (() => void) | undefined;
  const delayedSave = new Promise<void>((resolve) => { release = resolve; });
  check(release, 'Delayed-save fixture must be initialized.');
  const finishSave = release;
  plugin.saveData = () => delayedSave;
  const pendingSave = plugin.saveSettings();
  let unloaded = false;
  try {
    await unload();
    unloaded = true;
    check(!doc.querySelector('.jvt-right-sidebar-toggle, .jvt-collapse-tab-bar-button'),
      'Unload must remove custom controls.');
    button?.click();
    check(app.workspace.rightSplit.collapsed === collapsed, 'Detached button listeners must be cleaned up.');
    finishSave();
    await pendingSave;
    check(!Array.from(doc.body.classList).some((name) => name.startsWith('jvt-')),
      'A late save must not restore plugin body classes after unload.');
    check(!doc.querySelector('.jvt-right-sidebar-toggle, .jvt-collapse-tab-bar-button'),
      'A late save must not recreate custom controls after unload.');
  } finally {
    plugin.saveData = saveData;
    finishSave();
    await pendingSave;
    if (unloaded) {
      await load();
    }
  }
  return 'Unload cleans up controls/listeners; late settings saves cannot resurrect them';
}

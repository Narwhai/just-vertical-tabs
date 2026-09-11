import type { App } from 'obsidian';
import type JustVerticalTabsPlugin from '../src/main';
import type { JustVerticalTabsSettings } from '../src/settings';

type SidebarSide = 'left' | 'right';

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
  const originalLeftCollapsed = workspace.leftSplit.collapsed;
  const originalHeaderShown = doc.body.classList.contains('show-view-header');
  const originalLeaf = workspace.getMostRecentLeaf(workspace.rootSplit);
  check(originalLeaf, 'Open a note in the main workspace before running these tests.');
  const originalActions = originalLeaf.view.containerEl.querySelector<HTMLElement>('.view-actions');
  check(originalActions, 'The active view must have note-header actions.');
  const originalHeader = originalActions.closest('.view-header');
  check(originalHeader, 'The active view must have a note header.');
  const passed: string[] = [];
  const wait = (ms: number): Promise<void> => new Promise((resolve) => win.setTimeout(resolve, ms));
  const configure = async (changes: Partial<JustVerticalTabsSettings>): Promise<void> => {
    plugin.settings = { ...originalSettings, ...changes };
    await plugin.saveSettings();
  };
  const sidebarSplit = (side: SidebarSide) => side === 'left' ? workspace.leftSplit : workspace.rightSplit;
  const customButton = (side: SidebarSide): HTMLButtonElement => {
    const buttons = doc.querySelectorAll<HTMLButtonElement>(`.jvt-${side}-sidebar-toggle`);
    check(buttons.length === 1 && buttons[0], `Exactly one custom ${side} sidebar button must exist.`);
    return buttons[0];
  };
  const nativeButtons = (side: SidebarSide): HTMLElement[] => Array.from(
    doc.querySelectorAll<HTMLElement>(`.sidebar-toggle-button.mod-${side === 'left' ? 'primary' : 'secondary'}`),
  );
  const checkState = (button: HTMLButtonElement, side: SidebarSide): void => {
    const collapsed = sidebarSplit(side).collapsed;
    check(button.getAttribute('aria-expanded') === String(!collapsed), `${side}: expanded state is stale.`);
    check(
      button.getAttribute('aria-label') === `${collapsed ? 'Expand' : 'Collapse'} ${side} sidebar`,
      `${side}: sidebar action label is stale.`,
    );
    check(button.querySelector(`.lucide-panel-${side}-${collapsed ? 'open' : 'close'}`),
      `${side}: sidebar icon does not match the action.`);
  };
  const checkStableToggle = async (button: HTMLButtonElement, side: SidebarSide): Promise<void> => {
    const split = sidebarSplit(side);
    const otherSplit = sidebarSplit(side === 'left' ? 'right' : 'left');
    const otherCollapsed = otherSplit.collapsed;
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
        const before = split.collapsed;
        button.click();
        check(split.collapsed !== before, `${side}: click must toggle the sidebar exactly once.`);
        check(otherSplit.collapsed === otherCollapsed, `${side}: click must not toggle the opposite sidebar.`);
        checkState(button, side);
        for (const delay of [0, 16, 75, 250, 350]) {
          await wait(delay);
          const current = button.getBoundingClientRect();
          const currentHost = host.getBoundingClientRect();
          check(button === customButton(side) && button.parentElement === host && !removed,
            'The custom button was replaced or reparented during a sidebar animation.');
          check(Math.abs(current.y - currentHost.y - (rect.y - hostRect.y)) < 1,
            'Button moved vertically within its host.');
          check(Math.abs(current.x - currentHost.x - (rect.x - hostRect.x)) < 1,
            'Button moved horizontally within its host.');
          check(Math.abs(current.width - rect.width) < 1, 'Button width animated.');
          check(button.getAnimations({ subtree: true }).length === 0, 'Custom button animated.');
          check(nativeButtons(side).every((native) => !native.isShown()), `${side}: a native button or clone flashed.`);
          checkState(button, side);
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
          const button = customButton('right');
          const host = button.parentElement;
          check(host && host.matches('.workspace-tab-header-container'), 'Bottom button is not in the tab bar.');
          check(Boolean(host.querySelector('.jvt-collapse-tab-bar-button')) === showCollapseTabBarButton,
            'Tab-bar collapse visibility must be independent of sidebar controls.');
          const hostStyles = win.getComputedStyle(host);
          const buttonStyles = win.getComputedStyle(button);
          const bottomSpace = host.getBoundingClientRect().bottom - button.getBoundingClientRect().bottom;
          check(Math.abs(bottomSpace - parseFloat(hostStyles.paddingBottom) - parseFloat(buttonStyles.marginBottom)) < 1,
            'Sidebar button must stay at the bottom even without the tab-bar collapse button.');
          await checkStableToggle(button, 'right');
          const leftButton = customButton('left');
          check(originalHeader.firstElementChild === leftButton, 'Left button must be first in the note header, before navigation.');
          await checkStableToggle(leftButton, 'left');
          passed.push(`Left header + right bottom: ${side}, tab bar ${collapseTabBar ? 'collapsed' : 'expanded'}, collapse control ${showCollapseTabBarButton ? 'shown' : 'hidden'}`);
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
      const legacyLeft = probes.createDiv({ cls: 'sidebar-toggle-button mod-left' });
      check(win.getComputedStyle(primary).display === 'none', 'The primary/left native toggle must be hidden in RTL layouts.');
      check(win.getComputedStyle(legacyLeft).display === 'none', 'Legacy native left-toggle markup must be hidden.');
      doc.body.classList.remove('show-view-header');
      await wait(0);
      check(win.getComputedStyle(primary).display !== 'none', 'Hiding the header must restore the primary/left toggle.');
      check(win.getComputedStyle(legacyLeft).display !== 'none', 'Hiding the header must restore legacy left-toggle markup.');
      check(win.getComputedStyle(secondary).display === 'none', 'The right bottom control must remain independent of the left header control.');
      doc.body.classList.add('show-view-header');
      await wait(0);
      passed.push('Independent native suppression covers both legacy and RTL sidebar markup');
    } finally {
      probes.remove();
    }

    // An action after More options catches accidental append-to-end placement.
    extraAction = originalActions.createEl('button', { text: 'Integration test action' });
    await configure({ sidebarTogglePlacement: 'header', showCollapseTabBarButton: true });
    const headerButton = customButton('right');
    const moreOptions = Array.from(originalActions.children).find((el) => el.querySelector('.lucide-more-vertical'));
    check(moreOptions?.nextElementSibling === headerButton, 'Header button must follow More options, not all actions.');
    check(!headerButton.hasAttribute('data-tooltip-position'), 'Header tooltip must not retain sideways placement.');
    check(doc.querySelector('.jvt-collapse-tab-bar-button'), 'Header placement must not remove the tab-bar collapse button.');
    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    check(!headerButton.dispatchEvent(mouseDown), 'Mouse activation should preserve editor focus.');
    const leftHeaderButton = customButton('left');
    check(originalHeader.firstElementChild === leftHeaderButton, 'Left button must precede the navigation controls.');
    check(leftHeaderButton.type === 'button' && leftHeaderButton.tabIndex === 0, 'Left button must support keyboard focus and activation.');
    check(!leftHeaderButton.hasAttribute('data-tooltip-position'), 'Left header tooltip must appear below the control.');
    check(!leftHeaderButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })),
      'Left mouse activation should preserve editor focus.');
    await checkStableToggle(headerButton, 'right');
    await checkStableToggle(leftHeaderButton, 'left');
    passed.push('Both header controls: position, tooltips, focus preservation, and stable independent toggling');

    workspace.rightSplit.toggle();
    workspace.leftSplit.toggle();
    await wait(0);
    checkState(headerButton, 'right');
    checkState(leftHeaderButton, 'left');
    passed.push('Both sidebar controls stay synchronized with external/API toggles');

    const beforeRapidClicks = workspace.leftSplit.collapsed;
    for (let i = 0; i < 6; i++) {
      leftHeaderButton.click();
      checkState(leftHeaderButton, 'left');
    }
    await wait(500);
    check(workspace.leftSplit.collapsed === beforeRapidClicks, 'Rapid left toggles must preserve the final requested state.');
    check(customButton('left') === leftHeaderButton && originalHeader.firstElementChild === leftHeaderButton,
      'Rapid left toggles must not duplicate or relocate the control.');
    passed.push('Rapid left-sidebar clicks keep a single stable control and correct state');

    splitLeaf = workspace.createLeafBySplit(originalLeaf, 'vertical');
    await splitLeaf.setViewState({ type: 'empty', active: true });
    workspace.setActiveLeaf(splitLeaf, { focus: false });
    await wait(100);
    check(splitLeaf.view.containerEl.contains(customButton('right')), 'Right header button must follow the active main-workspace split.');
    check(splitLeaf.view.containerEl.querySelector('.view-header')?.firstElementChild === customButton('left'),
      'Left header button must follow the active main-workspace split.');
    workspace.setActiveLeaf(originalLeaf, { focus: false });
    await wait(100);
    check(originalActions.contains(customButton('right')), 'Right header button must return when switching tabs.');
    check(originalHeader.firstElementChild === customButton('left'), 'Left header button must return when switching tabs.');
    passed.push('Both header controls follow main-workspace split/tab changes without duplicates');

    doc.body.classList.remove('show-view-header');
    await wait(0);
    check(!doc.querySelector('.jvt-left-sidebar-toggle, .jvt-right-sidebar-toggle'), 'No custom button should be left in a hidden header.');
    check(nativeButtons('right').some((button) => button.isShown()), 'Native right control must remain available with a hidden header.');
    check(nativeButtons('left').some((button) => button.isShown()), 'Native left control must remain available with a hidden header.');
    doc.body.classList.add('show-view-header');
    await wait(0);
    check(originalActions.contains(customButton('right')), 'Right header control must return when the header is shown.');
    check(originalHeader.firstElementChild === customButton('left'), 'Left header control must return when the header is shown.');
    passed.push('Hidden headers restore both native controls; showing headers restores both custom controls');

    await configure({ sidebarTogglePlacement: 'default', showCollapseTabBarButton: false });
    check(!doc.querySelector('.jvt-right-sidebar-toggle'), 'Native placement must remove custom controls.');
    check(!doc.body.classList.contains('jvt-custom-sidebar-toggle'), 'Native placement must remove suppression.');
    check(nativeButtons('right').some((button) => button.isShown()), 'Native right toggle must be visible.');
    check(originalHeader.firstElementChild === customButton('left'), 'Native right placement must leave the left header control intact.');
    check(!doc.querySelector('.jvt-collapse-tab-bar-button'), 'Collapse button setting must work in native mode.');
    const native = nativeButtons('right')[0];
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
    if (workspace.leftSplit.collapsed !== originalLeftCollapsed) {
      workspace.leftSplit.toggle();
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
  const buttons = doc.querySelectorAll<HTMLButtonElement>('.jvt-left-sidebar-toggle, .jvt-right-sidebar-toggle');
  const collapsed = app.workspace.rightSplit.collapsed;
  const leftCollapsed = app.workspace.leftSplit.collapsed;
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
    check(!doc.querySelector('.jvt-left-sidebar-toggle, .jvt-right-sidebar-toggle, .jvt-collapse-tab-bar-button'),
      'Unload must remove custom controls.');
    for (const button of Array.from(buttons)) {
      button.click();
    }
    check(app.workspace.rightSplit.collapsed === collapsed, 'Detached right button listeners must be cleaned up.');
    check(app.workspace.leftSplit.collapsed === leftCollapsed, 'Detached left button listeners must be cleaned up.');
    finishSave();
    await pendingSave;
    check(!Array.from(doc.body.classList).some((name) => name.startsWith('jvt-')),
      'A late save must not restore plugin body classes after unload.');
    check(!doc.querySelector('.jvt-left-sidebar-toggle, .jvt-right-sidebar-toggle, .jvt-collapse-tab-bar-button'),
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

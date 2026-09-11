import { App, PluginSettingTab } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import JustVerticalTabsPlugin from './main';

export type TabBarSide = 'left' | 'right';
export type SidebarTogglePlacement = 'default' | 'header' | 'bottom';

export interface JustVerticalTabsSettings {
  side: TabBarSide;
  sidebarTogglePlacement: SidebarTogglePlacement;
  showTabIcons: boolean;
  collapseTabBar: boolean;
  showCollapseTabBarButton: boolean;
}

export const DEFAULT_SETTINGS: JustVerticalTabsSettings = {
  side: 'right',
  sidebarTogglePlacement: 'default',
  showTabIcons: true,
  collapseTabBar: false,
  showCollapseTabBarButton: true,
};

export class JustVerticalTabsSettingTab extends PluginSettingTab {
  plugin: JustVerticalTabsPlugin;

  constructor(app: App, plugin: JustVerticalTabsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: 'Tab bar side',
        desc: 'Choose whether the vertical tab bar appears on the left or right side of the editor pane.',
        control: {
          type: 'dropdown',
          key: 'side',
          defaultValue: DEFAULT_SETTINGS.side,
          options: { left: 'Left', right: 'Right' },
        },
      },
      {
        name: 'Right sidebar toggle placement',
        desc: "Use Obsidian's native toggle, or a stationary button in the note header after more options or at the bottom of the vertical tab bar.",
        control: {
          type: 'dropdown',
          key: 'sidebarTogglePlacement',
          defaultValue: DEFAULT_SETTINGS.sidebarTogglePlacement,
          options: {
            default: 'Default',
            header: 'Note header',
            bottom: 'Bottom of vertical tabs',
          },
        },
      },
      {
        name: 'Show tab icons',
        desc: 'Show or hide the file-type icons displayed to the left of tab titles.',
        control: { type: 'toggle', key: 'showTabIcons' },
      },
      {
        name: 'Collapse tab bar',
        desc: 'Collapse the vertical tab bar so each tab shows only its icon, or title initials when tab icons are hidden. You can also toggle this from the command palette.',
        control: { type: 'toggle', key: 'collapseTabBar' },
      },
      {
        name: 'Show collapse button',
        desc: 'Show or hide the tab bar collapse/expand button, independently of the right sidebar toggle placement.',
        control: { type: 'toggle', key: 'showCollapseTabBarButton' },
      },
    ];
  }

  /**
   * Routes every write through `plugin.saveSettings()` so `applySettings()`
   * (body classes, toggle placement, collapsed-label sync) runs after each
   * change. The default implementation only calls `saveData()`.
   */
  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === 'side' && typeof value === 'string') {
      await this.plugin.updateSide(value);
      return;
    }

    if (key === 'sidebarTogglePlacement' && typeof value === 'string') {
      this.plugin.settings.sidebarTogglePlacement =
        this.plugin.normalizeSidebarTogglePlacementValue(value);
      await this.plugin.saveSettings();
      return;
    }

    if (key === 'showTabIcons' && typeof value === 'boolean') {
      this.plugin.settings.showTabIcons = value;
      await this.plugin.saveSettings();
      return;
    }

    if (key === 'collapseTabBar' && typeof value === 'boolean') {
      this.plugin.settings.collapseTabBar = value;
      await this.plugin.saveSettings();
      return;
    }

    if (key === 'showCollapseTabBarButton' && typeof value === 'boolean') {
      this.plugin.settings.showCollapseTabBarButton = value;
      await this.plugin.saveSettings();
      return;
    }

    throw new Error(`Unexpected settings control: ${key}`);
  }
}

import { App, PluginSettingTab, Setting } from 'obsidian';
import JustVerticalTabsPlugin from './main';

export type TabBarSide = 'left' | 'right';
export type SidebarTogglePlacement = 'default' | 'header' | 'bottom';

export interface JustVerticalTabsSettings {
  side: TabBarSide;
  sidebarTogglePlacement: SidebarTogglePlacement;
  showTabIcons: boolean;
  collapseTabBar: boolean;
}

export const DEFAULT_SETTINGS: JustVerticalTabsSettings = {
  side: 'right',
  sidebarTogglePlacement: 'default',
  showTabIcons: true,
  collapseTabBar: false,
};

export class JustVerticalTabsSettingTab extends PluginSettingTab {
  plugin: JustVerticalTabsPlugin;

  constructor(app: App, plugin: JustVerticalTabsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName('Tab bar side')
      .setDesc('Choose whether the vertical tab bar appears on the left or right side of the editor pane.')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('left', 'Left')
          .addOption('right', 'Right')
          .setValue(this.plugin.settings.side)
          .onChange(async (value) => {
            await this.plugin.updateSide(value);
          });
      });

    new Setting(containerEl)
      .setName('Right sidebar toggle placement')
      .setDesc('Choose whether the right sidebar toggle stays in Obsidian\'s default location, moves into the note header after More options, or appears at the bottom of the vertical tab bar.')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('default', 'Default')
          .addOption('header', 'Note header')
          .addOption('bottom', 'Bottom of vertical tabs')
          .setValue(this.plugin.settings.sidebarTogglePlacement)
          .onChange(async (value) => {
            this.plugin.settings.sidebarTogglePlacement = this.plugin.normalizeSidebarTogglePlacementValue(value);
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Show tab icons')
      .setDesc('Show or hide the file-type icons displayed to the left of tab titles.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.showTabIcons)
          .onChange(async (value) => {
            this.plugin.settings.showTabIcons = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Collapse tab bar')
      .setDesc('Collapse the vertical tab bar so each tab shows only its icon, or title initials when tab icons are hidden. You can also toggle this from the command palette.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.collapseTabBar)
          .onChange(async (value) => {
            this.plugin.settings.collapseTabBar = value;
            await this.plugin.saveSettings();
          });
      });
  }
}

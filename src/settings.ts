import { App, PluginSettingTab, Setting } from 'obsidian';
import JustVerticalTabsPlugin from './main';

export type TabBarSide = 'left' | 'right';

export interface JustVerticalTabsSettings {
  side: TabBarSide;
  moveToggleToHeader: boolean;
}

export const DEFAULT_SETTINGS: JustVerticalTabsSettings = {
  side: 'right',
  moveToggleToHeader: false,
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
      .setName('Move sidebar toggle to note header')
      .setDesc('Move the right sidebar collapse button from the bottom of the tab bar into the note header, next to the other view action buttons.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.moveToggleToHeader)
          .onChange(async (value) => {
            this.plugin.settings.moveToggleToHeader = value;
            await this.plugin.saveSettings();
          });
      });
  }
}

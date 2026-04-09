import { App, PluginSettingTab, Setting } from 'obsidian';
import JustVerticalTabsPlugin from './main';

export type TabBarSide = 'left' | 'right';

export interface JustVerticalTabsSettings {
  side: TabBarSide;
}

export const DEFAULT_SETTINGS: JustVerticalTabsSettings = {
  side: 'right',
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
  }
}

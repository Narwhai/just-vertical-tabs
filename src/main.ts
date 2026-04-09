import { Plugin } from 'obsidian';
import {
  DEFAULT_SETTINGS,
  JustVerticalTabsSettingTab,
  type JustVerticalTabsSettings,
  type TabBarSide,
} from './settings';

export default class JustVerticalTabsPlugin extends Plugin {
  settings: JustVerticalTabsSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    document.body.classList.add('jvt-active');
    this.applySettings();

    this.addSettingTab(new JustVerticalTabsSettingTab(this.app, this));
  }

  onunload(): void {
    document.body.classList.remove('jvt-active', 'jvt-side-left', 'jvt-side-right');
  }

  async loadSettings(): Promise<void> {
    const loadedData = (await this.loadData()) as Partial<JustVerticalTabsSettings> | null;
    const side = this.normalizeSide(loadedData?.side);

    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loadedData,
      side,
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
  }
}

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEBATE_ROLES, DEFAULT_FREE_TARGET_PROVIDERS } from '../../shared/constants';
import { defaultSettings, activeProviders, normalizeSettings } from '../ui/settingsModel';

describe('three-provider settings', () => {
  it('keeps ChatGPT, Grok, and Gemini active and does not save conversation text by default', () => {
    const settings = defaultSettings();

    expect(activeProviders()).toEqual([...DEFAULT_FREE_TARGET_PROVIDERS]);
    expect(settings.saveConversationContent).toBe(false);
    expect(settings.presentation).toEqual({ chatgpt: 'side', grok: 'side', gemini: 'side' });
    expect(settings.modeRoles.debate).toEqual(DEFAULT_DEBATE_ROLES);
  });

  it('drops removed providers and remote adapter fields', () => {
    const settings = normalizeSettings({
      standbyProvider: 'grok',
      adapterBaseUrl: 'https://example.invalid/adapters',
      updaterChannel: 'stable',
      openProviders: ['chatgpt', 'removed-a', 'removed-b'],
      saveConversationContent: true,
    });

    expect(settings.openProviders).toEqual(['chatgpt']);
    expect(settings.saveConversationContent).toBe(true);
    expect(settings).not.toHaveProperty('standbyProvider');
    expect(settings).not.toHaveProperty('adapterBaseUrl');
    expect(settings).not.toHaveProperty('updaterChannel');
    expect(JSON.stringify(settings)).not.toContain('claude');
  });
});

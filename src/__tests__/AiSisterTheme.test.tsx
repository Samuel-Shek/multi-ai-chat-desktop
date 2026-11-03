import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../i18n/context';
import { AiSisterAvatar, AiSisterEnsembleCard } from '../ui/AiSisterTheme';

describe('AI-Sister commemorative theme components', () => {
  it('renders the ensemble card with the three provider portraits', () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="en">
        <AiSisterEnsembleCard />
      </I18nProvider>,
    );

    expect(html).toContain('AI-Sister Commemorative Edition');
    expect(html).toContain('Final commemorative edition');
    expect(html.match(/ai-sister-avatar--xs/g)).toHaveLength(3);
    for (const provider of ['chatgpt', 'grok', 'gemini']) {
      expect(html).toContain(`data-provider="${provider}"`);
    }
  });

  it('marks an active provider portrait for the speaking animation', () => {
    const html = renderToStaticMarkup(<AiSisterAvatar provider="grok" active size="lg" />);

    expect(html).toContain('data-provider="grok"');
    expect(html).toContain('data-active="true"');
    expect(html).toContain('ai-sister-avatar--lg');
  });

  it('uses the supplied Gemini portrait for the optional provider', () => {
    const html = renderToStaticMarkup(<AiSisterAvatar provider="gemini" size="md" />);

    expect(html).toContain('data-provider="gemini"');
    expect(html).toContain('<img');
    expect(html).toContain('gemini.webp');
    expect(html).not.toContain('data-avatar-fallback="true"');
  });
});

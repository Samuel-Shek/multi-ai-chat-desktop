import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlatformNoticeBanner } from '../ui/PlatformNoticeBanner';
import { platformNoticeFromError, platformNoticeFromSettings } from '../ui/platformNotice';

const NOTICE =
  'macOS 14+ required. Separate ChatGPT, Grok, and Gemini logins need macOS 14 or later. This build will not fall back to one shared login store.';

describe('macOS 14 provider store notice', () => {
  it('reads the explicit notice from settings and from an open failure', () => {
    expect(platformNoticeFromSettings({ platformNotice: NOTICE })).toBe(NOTICE);
    expect(platformNoticeFromSettings({})).toBeUndefined();
    expect(platformNoticeFromSettings({ platformNotice: 'something else' })).toBeUndefined();
    expect(platformNoticeFromError(new Error(NOTICE))).toBe(NOTICE);
    expect(platformNoticeFromError(NOTICE)).toBe(NOTICE);
    expect(platformNoticeFromError(new Error('network down'))).toBeUndefined();
  });

  it('renders the macOS 14+ required message', () => {
    const html = renderToStaticMarkup(createElement(PlatformNoticeBanner, { notice: NOTICE }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('macOS 14+ required');
    expect(renderToStaticMarkup(createElement(PlatformNoticeBanner, { notice: '' }))).toBe('');
  });
});
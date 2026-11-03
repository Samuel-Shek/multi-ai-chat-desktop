const MACOS_14_REQUIRED = 'macOS 14+ required';

export function platformNoticeFromError(error: unknown): string | undefined {
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  const trimmed = message.trim();
  return trimmed.includes(MACOS_14_REQUIRED) ? trimmed : undefined;
}

export function platformNoticeFromSettings(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const notice = (value as { platformNotice?: unknown }).platformNotice;
  return platformNoticeFromError(typeof notice === 'string' ? notice : '');
}

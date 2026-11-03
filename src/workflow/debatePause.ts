import { AI_PROVIDERS } from '../../shared/constants';
import type { AIProvider } from '../../shared/types';
import type { I18nKey } from '../i18n/keys';
import type { Locale } from '../i18n/resolve';
import { formatI18n, t } from '../i18n/t';
import { isProviderPageReloadedError, ProviderResponseError } from './providerResponse';

export type DebatePauseReason =
  | 'cancelled'
  | 'human-verification'
  | 'usage-limit'
  | 'incomplete-reply'
  | 'unknown-send';

const CANCEL_MESSAGE = 'Workflow cancelled by user';
const HUMAN_VERIFICATION =
  /captcha|human verification|verify you are human|security challenge|cloudflare|\/sorry|unusual traffic|are you a robot/i;
const USAGE_LIMIT = /rate[ -]?limit|usage limit|usage cap|quota|too many requests/i;
const TIMEOUT = /response timed out/i;
const UNKNOWN_SEND = /send was not accepted|page reloaded during its turn|superseded by a newer send/i;
const INTERSTITIAL_MAX_CHARS = 500;

const PAUSE_KEYS = {
  cancelled: 'workflow.debatePaused.cancelled',
  'human-verification': 'workflow.debatePaused.humanVerification',
  'usage-limit': 'workflow.debatePaused.usageLimit',
  'incomplete-reply': 'workflow.debatePaused.incompleteReply',
  'unknown-send': 'workflow.debatePaused.unknownSend',
} as const satisfies Record<DebatePauseReason, I18nKey>;

export class DebatePausedError extends Error {
  readonly reason: DebatePauseReason;
  readonly provider: AIProvider | undefined;

  constructor(reason: DebatePauseReason, provider: AIProvider | undefined, detail: string) {
    super(detail);
    this.name = 'DebatePausedError';
    this.reason = reason;
    this.provider = provider;
  }
}

export function isDebatePausedError(error: unknown): error is DebatePausedError {
  return error instanceof DebatePausedError;
}

export function isWorkflowCancelError(error: unknown): boolean {
  return error instanceof Error && error.message === CANCEL_MESSAGE;
}

export function classifyDebateStop(input: {
  error?: unknown;
  response?: string;
  truncated?: boolean;
}): DebatePauseReason | undefined {
  if (isWorkflowCancelError(input.error)) return 'cancelled';
  if (input.truncated) return 'incomplete-reply';
  const errorText = input.error instanceof Error ? input.error.message : '';
  if (TIMEOUT.test(errorText)) return 'incomplete-reply';
  const responseText = input.response ?? (input.error instanceof ProviderResponseError ? input.error.response : '');
  const interstitial = classifyInterstitial(errorText) ?? classifyInterstitial(responseText);
  if (interstitial) return interstitial;
  if (isProviderPageReloadedError(input.error) || UNKNOWN_SEND.test(errorText) || UNKNOWN_SEND.test(responseText)) {
    return 'unknown-send';
  }
  return undefined;
}

function classifyInterstitial(text: string): DebatePauseReason | undefined {
  const sample = text.trim();
  if (!sample || sample.length > INTERSTITIAL_MAX_CHARS) return undefined;
  if (HUMAN_VERIFICATION.test(sample)) return 'human-verification';
  if (USAGE_LIMIT.test(sample)) return 'usage-limit';
  return undefined;
}

export function debatePauseFromStep(provider: AIProvider, error: unknown): Error {
  if (isDebatePausedError(error)) return error;
  const response = error instanceof ProviderResponseError ? error.response : undefined;
  const reason = classifyDebateStop({ error, response });
  if (reason) return new DebatePausedError(reason, provider, error instanceof Error ? error.message : String(error));
  if (error instanceof ProviderResponseError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new DebatePausedError('unknown-send', provider, detail);
}

export function debatePauseStatus(error: DebatePausedError, locale: Locale): string {
  const provider = error.provider ? AI_PROVIDERS[error.provider].name : 'the provider';
  return formatI18n(t(PAUSE_KEYS[error.reason], locale), { provider });
}

export function debatePauseForWorkflow(mode: string, error: unknown, locale: Locale): string | undefined {
  if (isDebatePausedError(error)) return debatePauseStatus(error, locale);
  if (mode !== 'debate') return undefined;
  if (isWorkflowCancelError(error)) {
    return debatePauseStatus(new DebatePausedError('cancelled', undefined, CANCEL_MESSAGE), locale);
  }
  const reason = classifyDebateStop({ error });
  if (!reason) return undefined;
  const provider = error instanceof ProviderResponseError ? error.provider : undefined;
  return debatePauseStatus(
    new DebatePausedError(reason, provider, error instanceof Error ? error.message : String(error)),
    locale,
  );
}

export function debateForwardingNotice(
  roles: ReadonlyMap<string, AIProvider>,
  openingPrompt: string,
  locale: Locale,
): string {
  const name = (role: string) => {
    const provider = roles.get(role);
    return provider ? AI_PROVIDERS[provider].name : role;
  };
  return [
    formatI18n(t('workflow.debateForwarding', locale), {
      proName: name('pro'),
      proRole: t('workflowRole.debate.pro', locale),
      conName: name('con'),
      conRole: t('workflowRole.debate.con', locale),
      judgeName: name('judge'),
      judgeRole: t('workflowRole.debate.judge', locale),
      summaryName: name('summary'),
      summaryRole: t('workflowRole.debate.summary', locale),
    }),
    '',
    openingPrompt,
  ].join('\n');
}

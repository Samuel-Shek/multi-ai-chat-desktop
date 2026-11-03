import type { AIProvider } from '../../shared/types';
import { resetProviderPullState } from '../bridge/pull';
import { abortWorkflow, checkAborted, getInFlightProviders, onWorkflowAbort, stopProvider } from './cancel';
import {
  isProviderPageReloadedError,
  isRetryableSendRejection,
  providerResponseError,
  ProviderResponseError,
} from './providerResponse';
import { classifyDebateStop, debatePauseFromStep, DebatePausedError, isDebatePausedError } from './debatePause';
import { sendAndWait } from './sendAndWait';
import { SKIP_RESPONSE } from './state';
import { awaitStepTimeoutAction, emitCountdown } from './stepTimeout';
import { tearDownWaiters } from './teardown';
import { consumeTruncated } from './waitForResponse';

export const SEND_REJECTION_RETRY_DELAY_MS = 1_500;

export interface RunStepOptions {
  recoverProviderErrors?: boolean;
  /** Debate only. Stop the round instead of retrying or opening the recovery dialog. */
  pauseInsteadOfRetry?: boolean;
}

function waitForSendRetry(): Promise<void> {
  checkAborted();
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      unsubscribe();
      resolve();
    }, SEND_REJECTION_RETRY_DELAY_MS);
    const unsubscribe = onWorkflowAbort((reason) => {
      globalThis.clearTimeout(timer);
      unsubscribe();
      reject(reason);
    });
  });
}

export async function runStep(
  provider: AIProvider,
  prompt: string,
  reservedTurn?: number,
  options: RunStepOptions = {},
): Promise<{ response: string; turn: number }> {
  let sendRejectionRetries = 0;
  for (;;) {
    checkAborted();
    emitCountdown(provider);
    try {
      const result = await sendAndWait(provider, prompt, reservedTurn);
      const truncated = consumeTruncated(provider, result.turn);
      if (options.pauseInsteadOfRetry) {
        const stop = classifyDebateStop({ response: result.response, truncated });
        if (stop) throw new DebatePausedError(stop, provider, truncated ? 'truncated reply' : result.response);
      }
      const responseError = providerResponseError(provider, result.response);
      if (!responseError) return result;
      if (options.pauseInsteadOfRetry) throw responseError;
      if (sendRejectionRetries === 0 && isRetryableSendRejection(responseError)) {
        sendRejectionRetries += 1;
        await waitForSendRetry();
        continue;
      }
      throw responseError;
    } catch (error) {
      if (isDebatePausedError(error)) throw error;
      if (options.pauseInsteadOfRetry) throw debatePauseFromStep(provider, error);
      checkAborted();
      if (error instanceof ProviderResponseError && options.recoverProviderErrors !== true) throw error;
      const failureKind = error instanceof ProviderResponseError ? 'provider-error' : 'timeout';
      const recoveryDetail = isProviderPageReloadedError(error) ? 'provider-page-reloaded' : undefined;
      const action = await awaitStepTimeoutAction(provider, failureKind, recoveryDetail);
      if (action === 'retry') {
        await stopProvider(provider);
        resetProviderPullState(provider);
        continue;
      }
      if (action === 'skip') return { response: SKIP_RESPONSE, turn: -1 };
      if (action === 'cancel') {
        abortWorkflow();
        await stopProvider(provider);
        await tearDownWaiters(getInFlightProviders(), { stopClick: true });
      }
      throw error;
    }
  }
}

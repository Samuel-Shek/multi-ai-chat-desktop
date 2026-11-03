import { describe, expect, it } from 'vitest';
import type { BridgeMessage } from '../../shared/types';
import {
  MANUAL_LOCK_IDLE_MS,
  POINTERDOWN_DEBOUNCE_MS,
  manualFocusLockForControl,
  pointerDebounceLock,
  providerFromRoleAssignment,
  refreshManualLockOnRoleAssignment,
  shouldAutoFocus,
} from '../ui/autoFocus';

describe('auto focus helpers', () => {
  it('extracts providers only from ROLE_ASSIGNMENT messages', () => {
    expect(providerFromRoleAssignment({ v: 1, action: 'ROLE_ASSIGNMENT', provider: 'chatgpt' })).toBe('chatgpt');
    expect(providerFromRoleAssignment({ v: 1, action: 'WORKFLOW_STATUS', provider: 'chatgpt' })).toBeUndefined();
    expect(providerFromRoleAssignment({ v: 1, action: 'ROLE_ASSIGNMENT', provider: 'system' } as unknown as BridgeMessage)).toBeUndefined();
    expect(providerFromRoleAssignment({ v: 1, action: 'ROLE_ASSIGNMENT' })).toBeUndefined();
  });

  it('focuses only when follow is enabled, unlocked, candidate exists, and center changes', () => {
    expect(
      shouldAutoFocus({
        autoFollowEnabled: false,
        candidate: 'chatgpt',
        centered: 'grok',
      }),
    ).toBe(false);
    expect(
      shouldAutoFocus({
        autoFollowEnabled: true,
        manualLock: { provider: 'grok', at: 10 },
        candidate: 'chatgpt',
        centered: 'grok',
      }),
    ).toBe(false);
    expect(
      shouldAutoFocus({
        autoFollowEnabled: true,
        candidate: 'chatgpt',
        centered: 'chatgpt',
      }),
    ).toBe(false);
    expect(
      shouldAutoFocus({
        autoFollowEnabled: true,
        centered: 'grok',
      }),
    ).toBe(false);
    expect(
      shouldAutoFocus({
        autoFollowEnabled: true,
        candidate: 'chatgpt',
        centered: 'grok',
      }),
    ).toBe(true);
  });

  it('keeps a manual lock alive while role assignments continue and expires after idle', () => {
    const lock = { provider: 'grok' as const, at: 1000 };
    expect(refreshManualLockOnRoleAssignment(lock, 1000 + MANUAL_LOCK_IDLE_MS - 1)).toEqual({
      provider: 'grok',
      at: 1000 + MANUAL_LOCK_IDLE_MS - 1,
    });
    expect(refreshManualLockOnRoleAssignment(lock, 1000 + MANUAL_LOCK_IDLE_MS)).toBeUndefined();
  });

  it('does not create a manual lock when the provider is already centered', () => {
    expect(manualFocusLockForControl('chatgpt', 'center', 1000)).toBeUndefined();
    expect(manualFocusLockForControl('chatgpt', 'side', 1000)).toEqual({ provider: 'chatgpt', at: 1000 });
    expect(manualFocusLockForControl('chatgpt', 'chip', 1000)).toEqual({ provider: 'chatgpt', at: 1000 });
  });

  it('keeps manual lock idle expiry frozen while workflow is paused', () => {
    const lock = { provider: 'grok' as const, at: 1000 };
    expect(
      refreshManualLockOnRoleAssignment(lock, 1000 + MANUAL_LOCK_IDLE_MS + 1, {
        idlePaused: true,
      }),
    ).toEqual({ provider: 'grok', at: 1000 + MANUAL_LOCK_IDLE_MS + 1 });
  });

  it('creates a temporary lock during pointerdown debounce', () => {
    expect(pointerDebounceLock(undefined, 1000)).toBeUndefined();
    expect(pointerDebounceLock({ provider: 'grok', at: 1000 }, 1000 + POINTERDOWN_DEBOUNCE_MS - 1)).toEqual({
      provider: 'grok',
      at: 1000,
    });
    expect(pointerDebounceLock({ provider: 'grok', at: 1000 }, 1000 + POINTERDOWN_DEBOUNCE_MS)).toBeUndefined();
  });
});

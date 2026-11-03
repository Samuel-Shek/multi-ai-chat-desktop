import type { AIProvider } from '../../shared/types';
import { AI_PROVIDERS, ALL_AI_PROVIDERS } from '../../shared/constants';
import { DEFAULT_COLUMN_WIDTHS, type ColumnWidths, clampColumnWidths } from './dockLayout';
import { DEFAULT_FOCUS_PANE_WIDTH, clampFocusPaneWidth } from './focusLayout';
import {
  DEFAULT_SLOT_ASSIGNMENT,
  SLOT_IDS,
  type SlotAssignment,
  normalizeSlotAssignment,
} from './slotAssignment';
import {
  keepModeRolesWithinProviders,
  type ModeRoleAssignments,
  migrateLegacyModeRoleAssignments,
  normalizeModeRoleAssignments,
} from './modeRoleAssignment';
import { isSnapshotRedactionTier, type SnapshotRedactionTier } from '../workflow/snapshot/types';
import { defaultPresentation, normalizePresentation, type PresentationByProvider } from './presentation';
import {
  normalizeLanguageSetting,
  normalizeResponseLanguageSetting,
  type LanguageSetting,
  type ResponseLanguageSetting,
} from '../i18n/resolve';

export interface AppSettings {
  settingsSchemaVersion: number;
  language: LanguageSetting;
  responseLanguage: ResponseLanguageSetting;
  theme: 'light' | 'dark' | 'ai-sister';
  fontSize: number;
  layoutMode: 'focus';
  focusPaneWidth: number;
  columnWidths: ColumnWidths;
  slotAssignment: SlotAssignment;
  modeRoles: ModeRoleAssignments;
  openProviders: AIProvider[];
  portable: boolean;
  telemetry: 'none';
  /** Off by default. When false, conversation text is not written to local storage. */
  saveConversationContent: boolean;
  snapshotPersistence: boolean;
  snapshotRedactionTier: SnapshotRedactionTier;
  presentation: PresentationByProvider;
}

const PROVIDERS = Object.keys(AI_PROVIDERS) as AIProvider[];
export const SETTINGS_SCHEMA_VERSION = 2;
const LEGACY_MODE_ROLE_MIGRATION_VERSION = 1;

export function activeProviders(): AIProvider[] {
  return [...ALL_AI_PROVIDERS];
}

export function defaultSettings(): AppSettings {
  return {
    settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
    language: 'system',
    responseLanguage: 'auto',
    theme: 'light',
    fontSize: DEFAULT_FONT_SIZE,
    layoutMode: 'focus',
    focusPaneWidth: DEFAULT_FOCUS_PANE_WIDTH,
    columnWidths: { ...DEFAULT_COLUMN_WIDTHS },
    slotAssignment: { ...DEFAULT_SLOT_ASSIGNMENT },
    modeRoles: normalizeModeRoleAssignments(undefined),
    openProviders: [],
    portable: false,
    telemetry: 'none',
    saveConversationContent: false,
    snapshotPersistence: false,
    snapshotRedactionTier: 'metadata-only',
    presentation: defaultPresentation(),
  };
}

function providerList(value: unknown): AIProvider[] {
  if (!Array.isArray(value)) return [];
  return value.filter((provider): provider is AIProvider => PROVIDERS.includes(provider));
}

function snapshotRedactionTier(value: unknown, fallback: SnapshotRedactionTier): SnapshotRedactionTier {
  return isSnapshotRedactionTier(value) ? value : fallback;
}

function theme(value: unknown, fallback: AppSettings['theme']): AppSettings['theme'] {
  return value === 'light' || value === 'dark' || value === 'ai-sister' ? value : fallback;
}

export const DEFAULT_FONT_SIZE = 16;
// 下限 10px，避免 UI 縮到無法操作；依需求不限制上限。
export const MIN_FONT_SIZE = 10;

function fontSize(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_FONT_SIZE ? value : DEFAULT_FONT_SIZE;
}

function columnWidths(value: unknown, fallback: ColumnWidths): ColumnWidths {
  if (!value || typeof value !== 'object') return { ...fallback };
  const input = value as Partial<Record<keyof ColumnWidths, unknown>>;
  return clampColumnWidths(
    {
      left: typeof input.left === 'number' ? input.left : fallback.left,
      right: typeof input.right === 'number' ? input.right : fallback.right,
    },
    1400,
  );
}

function legacyFocusPaneWidth(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Partial<Record<keyof ColumnWidths, unknown>>;
  return typeof input.left === 'number' ? input.left : undefined;
}

function focusPaneWidth(value: unknown, legacyColumnWidths: unknown, fallback: number): number {
  const candidate = typeof value === 'number' ? value : legacyFocusPaneWidth(legacyColumnWidths) ?? fallback;
  return clampFocusPaneWidth(candidate, 1400);
}

export function normalizeSettings(value: unknown): AppSettings {
  const defaults = defaultSettings();
  if (!value || typeof value !== 'object') return defaults;
  const input = value as Partial<Record<keyof AppSettings, unknown>>;
  const normalizedColumnWidths = columnWidths(input.columnWidths, defaults.columnWidths);
  const storedSchemaVersion =
    typeof input.settingsSchemaVersion === 'number' &&
    Number.isInteger(input.settingsSchemaVersion) &&
    input.settingsSchemaVersion >= 0
      ? input.settingsSchemaVersion
      : 0;
  const normalizedModeRoles =
    storedSchemaVersion < LEGACY_MODE_ROLE_MIGRATION_VERSION
      ? migrateLegacyModeRoleAssignments(input.modeRoles, defaults.modeRoles)
      : normalizeModeRoleAssignments(input.modeRoles, defaults.modeRoles);
  const normalizedPresentation = normalizePresentation(input.presentation, defaults.presentation);

  return {
    settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
    language: normalizeLanguageSetting(input.language),
    responseLanguage: normalizeResponseLanguageSetting(input.responseLanguage),
    theme: theme(input.theme, defaults.theme),
    fontSize: fontSize(input.fontSize),
    layoutMode: 'focus',
    focusPaneWidth: focusPaneWidth(input.focusPaneWidth, input.columnWidths, defaults.focusPaneWidth),
    columnWidths: normalizedColumnWidths,
    slotAssignment: normalizeSlotAssignment(input.slotAssignment, defaults.slotAssignment),
    modeRoles: keepModeRolesWithinProviders(normalizedModeRoles, activeProviders()),
    openProviders: Array.from(new Set(providerList(input.openProviders))),
    portable: input.portable === true,
    telemetry: 'none',
    saveConversationContent: input.saveConversationContent === true,
    snapshotPersistence: input.snapshotPersistence === true,
    snapshotRedactionTier: snapshotRedactionTier(input.snapshotRedactionTier, defaults.snapshotRedactionTier),
    presentation: normalizedPresentation,
  };
}

export function mergeSettings(loaded: unknown, patch: Partial<AppSettings>): AppSettings {
  return normalizeSettings({
    ...normalizeSettings(loaded),
    ...patch,
    settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
  });
}

export function slotProviders(assignment: SlotAssignment, side: 'left' | 'right'): AIProvider[] {
  const slots = side === 'left' ? SLOT_IDS.slice(0, 2) : SLOT_IDS.slice(2);
  return slots.map((slot) => assignment[slot]);
}

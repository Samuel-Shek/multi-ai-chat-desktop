import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODE_ROLE_ASSIGNMENTS,
  assignModeRole,
  migrateLegacyModeRoleAssignments,
  normalizeModeRoleAssignments,
} from '../ui/modeRoleAssignment';
import { defaultRolesForPreset } from '../ui/presetCatalogData';
import { mergeSettings, normalizeSettings, SETTINGS_SCHEMA_VERSION } from '../ui/settingsModel';

const LEGACY_MODE_ROLES = {
  debate: { pro: 'chatgpt', con: 'claude', judge: 'gemini', summary: 'gemini' },
  consult: { first: 'chatgpt', second: 'gemini', reviewer: 'claude', summary: 'gemini' },
  coding: { planner: 'gemini', reviewer: 'chatgpt', coder: 'claude', tester: 'chatgpt' },
  roundtable: { first: 'claude', second: 'gemini', third: 'chatgpt', fourth: 'claude' },
};

describe('normalizeModeRoleAssignments', () => {
  it('uses only the three providers, with Gemini judging and summarising debate', () => {
    expect(DEFAULT_MODE_ROLE_ASSIGNMENTS.debate).toEqual({
      pro: 'chatgpt',
      con: 'grok',
      judge: 'gemini',
      summary: 'gemini',
    });
    expect(DEFAULT_MODE_ROLE_ASSIGNMENTS.consult.first).not.toBe(DEFAULT_MODE_ROLE_ASSIGNMENTS.consult.second);
    for (const roles of Object.values(DEFAULT_MODE_ROLE_ASSIGNMENTS)) {
      for (const provider of Object.values(roles)) {
        expect(['chatgpt', 'grok', 'gemini']).toContain(provider);
      }
    }
  });

  it('fills defaults for missing/garbage input', () => {
    expect(normalizeModeRoleAssignments(undefined)).toEqual(DEFAULT_MODE_ROLE_ASSIGNMENTS);
    expect(normalizeModeRoleAssignments({ debate: { pro: 'bogus' } }).debate.pro).toBe(
      DEFAULT_MODE_ROLE_ASSIGNMENTS.debate.pro,
    );
  });

  it('migrates exact legacy three-provider defaults without replacing custom modes', () => {
    const migrated = migrateLegacyModeRoleAssignments({
      ...LEGACY_MODE_ROLES,
      consult: { first: 'grok', second: 'gemini', reviewer: 'claude', summary: 'chatgpt' },
    });

    expect(migrated.debate).toEqual(DEFAULT_MODE_ROLE_ASSIGNMENTS.debate);
    expect(migrated.coding).toEqual(DEFAULT_MODE_ROLE_ASSIGNMENTS.coding);
    expect(migrated.roundtable).toEqual(DEFAULT_MODE_ROLE_ASSIGNMENTS.roundtable);
    expect(migrated.consult).toEqual({ first: 'grok', second: 'gemini', reviewer: 'gemini', summary: 'chatgpt' });
  });

  it('runs the legacy migration only for unversioned saved settings', () => {
    const normalizedLegacy = normalizeModeRoleAssignments(LEGACY_MODE_ROLES);
    expect(normalizedLegacy.debate.con).toBe(DEFAULT_MODE_ROLE_ASSIGNMENTS.debate.con);
    expect(JSON.stringify(normalizedLegacy)).not.toContain('claude');

    const upgraded = normalizeSettings({ modeRoles: LEGACY_MODE_ROLES });
    expect(upgraded.settingsSchemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(upgraded.modeRoles).toEqual(DEFAULT_MODE_ROLE_ASSIGNMENTS);

    const savedCustom = mergeSettings(upgraded, { modeRoles: normalizedLegacy });
    expect(savedCustom.modeRoles).toEqual(normalizedLegacy);
    expect(normalizeSettings(savedCustom).modeRoles).toEqual(normalizedLegacy);
  });

  it('keeps valid overrides and allows the same provider in multiple roles', () => {
    const normalized = normalizeModeRoleAssignments({
      debate: { pro: 'gemini', con: 'grok', judge: 'gemini', summary: 'grok' },
    });
    expect(normalized.debate).toEqual({ pro: 'gemini', con: 'grok', judge: 'gemini', summary: 'grok' });
  });
});

describe('defaultRolesForPreset with custom assignments', () => {
  it('returns the customized roles for the mode', () => {
    const custom = assignModeRole(
      assignModeRole(DEFAULT_MODE_ROLE_ASSIGNMENTS, 'debate', 'pro', 'gemini'),
      'debate',
      'con',
      'grok',
    );
    expect(defaultRolesForPreset('debate', undefined, custom)).toMatchObject({ pro: 'gemini', con: 'grok' });
  });

  it('brainstorm preset uses the roundtable assignment', () => {
    const custom = assignModeRole(DEFAULT_MODE_ROLE_ASSIGNMENTS, 'roundtable', 'first', 'grok');
    expect(defaultRolesForPreset('free', 'brainstorm', custom)).toMatchObject({ first: 'grok' });
  });
});

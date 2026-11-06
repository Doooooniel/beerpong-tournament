import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  GROUP_COUNTS,
  STRUCTURAL_SETTINGS,
  SettingsPatchSchema,
  SettingsSchema,
} from '../index.js';

const withSettings = (patch: Record<string, unknown>): unknown => ({
  ...DEFAULT_SETTINGS,
  ...patch,
});
const withTimer = (patch: Record<string, unknown>): unknown => ({
  ...DEFAULT_SETTINGS,
  timerByPhase: { ...DEFAULT_SETTINGS.timerByPhase, ...patch },
});

describe('DEFAULT_SETTINGS (SPEC → Einstellungen)', () => {
  it('Einstellungen: DEFAULT_SETTINGS besteht SettingsSchema', () => {
    expect(SettingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });

  it('M04: Standardmodus ist Gruppen + KO', () => {
    expect(DEFAULT_SETTINGS.mode).toBe('groupsKo');
  });

  it('M05: Standard-Gruppenanzahl ist 2', () => {
    expect(DEFAULT_SETTINGS.groupCount).toBe(2);
  });

  it('S01: Becherdifferenz standardmäßig aus', () => {
    expect(DEFAULT_SETTINGS.trackCups).toBe(false);
  });

  it('S04: Spiel um Platz 3 standardmäßig aus', () => {
    expect(DEFAULT_SETTINGS.thirdPlaceMatch).toBe(false);
  });

  it('M10/ADR 026: advancersPerGroup standardmäßig null (Berechnung beim Start)', () => {
    expect(DEFAULT_SETTINGS.advancersPerGroup).toBeNull();
  });

  it('M12: Gruppenphase 15 min', () => {
    expect(DEFAULT_SETTINGS.timerByPhase.group).toBe(900_000);
  });

  it.each(['ko64', 'ko32', 'ko16', 'quarterfinal'] as const)('M12: KO-Stufe %s 10 min', (stage) => {
    expect(DEFAULT_SETTINGS.timerByPhase[stage]).toBe(600_000);
  });

  it.each(['semifinal', 'thirdPlace', 'final'] as const)(
    'M12: %s ohne Zeitlimit (null)',
    (stage) => {
      expect(DEFAULT_SETTINGS.timerByPhase[stage]).toBeNull();
    },
  );

  it('S03: Vorwarnungen 5 min / 1 min / 30 s', () => {
    expect(DEFAULT_SETTINGS.timerWarningsMs).toEqual([300_000, 60_000, 30_000]);
  });

  it('S03: Ton standardmäßig an', () => {
    expect(DEFAULT_SETTINGS.soundEnabled).toBe(true);
  });

  it('S06: Rotationsintervall 15 s', () => {
    expect(DEFAULT_SETTINGS.rotationIntervalMs).toBe(15_000);
  });

  it('S02: showUpcomingOnlyInPreparing ist ein boolescher Wert', () => {
    expect(typeof DEFAULT_SETTINGS.showUpcomingOnlyInPreparing).toBe('boolean');
  });
});

describe('SettingsSchema (SPEC → Einstellungen)', () => {
  it.each(['semifinal', 'thirdPlace', 'final'] as const)(
    'M12: timerByPhase.%s mit Wert wird abgelehnt',
    (stage) => {
      expect(SettingsSchema.safeParse(withTimer({ [stage]: 600_000 })).success).toBe(false);
    },
  );

  it.each(['group', 'ko64', 'ko32', 'ko16', 'quarterfinal'] as const)(
    'M12: timerByPhase.%s darf null sein (ohne Limit)',
    (stage) => {
      expect(SettingsSchema.safeParse(withTimer({ [stage]: null })).success).toBe(true);
    },
  );

  it.each([0, -1, 1.5])('M12: Timerdauer %s wird abgelehnt', (value) => {
    expect(SettingsSchema.safeParse(withTimer({ group: value })).success).toBe(false);
  });

  it('M12: timerByPhase ohne Pflichtschlüssel wird abgelehnt', () => {
    const { final: _final, ...rest } = DEFAULT_SETTINGS.timerByPhase;
    expect(_final).toBeNull();
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, timerByPhase: rest }).success).toBe(
      false,
    );
  });

  it.each([1, 2, 4, 8, 16])('M05: Gruppenanzahl %i (Zweierpotenz) wird akzeptiert', (n) => {
    expect(SettingsSchema.safeParse(withSettings({ groupCount: n })).success).toBe(true);
  });

  it.each([0, 3, 5, 6, 7, 12, -2, 1.5])('M05: Gruppenanzahl %s wird abgelehnt', (n) => {
    expect(SettingsSchema.safeParse(withSettings({ groupCount: n })).success).toBe(false);
  });

  it('M05: GROUP_COUNTS enthält nur Zweierpotenzen ab 1', () => {
    for (const n of GROUP_COUNTS) {
      expect(Number.isInteger(Math.log2(n))).toBe(true);
    }
    expect(GROUP_COUNTS[0]).toBe(1);
  });

  it.each(['groupsKo', 'koOnly'])('M04: Modus %s wird akzeptiert', (mode) => {
    expect(SettingsSchema.safeParse(withSettings({ mode })).success).toBe(true);
  });

  it.each(['groups', 'ko', ''])('M04: unbekannter Modus "%s" wird abgelehnt', (mode) => {
    expect(SettingsSchema.safeParse(withSettings({ mode })).success).toBe(false);
  });

  it.each([null, 1, 2, 4])('M10: advancersPerGroup %s ist im Schema zulässig', (value) => {
    expect(SettingsSchema.safeParse(withSettings({ advancersPerGroup: value })).success).toBe(true);
  });

  it.each([0, -1, 1.5])('M10: advancersPerGroup %s wird abgelehnt', (value) => {
    expect(SettingsSchema.safeParse(withSettings({ advancersPerGroup: value })).success).toBe(
      false,
    );
  });

  it.each([
    { key: 'timerWarningsMs', value: [0] },
    { key: 'timerWarningsMs', value: [-30_000] },
    { key: 'rotationIntervalMs', value: 0 },
    { key: 'soundEnabled', value: 'yes' },
    { key: 'trackCups', value: 1 },
  ])('S03/S06: ungültiger Wert für $key wird abgelehnt', ({ key, value }) => {
    expect(SettingsSchema.safeParse(withSettings({ [key]: value })).success).toBe(false);
  });

  it('S03: leere Warnliste ist zulässig (keine Vorwarnungen)', () => {
    expect(SettingsSchema.safeParse(withSettings({ timerWarningsMs: [] })).success).toBe(true);
  });

  it('Einstellungen: unbekannter Schlüssel wird abgelehnt', () => {
    expect(SettingsSchema.safeParse(withSettings({ colour: 'red' })).success).toBe(false);
  });

  it('Einstellungen: unbekannter Schlüssel in timerByPhase wird abgelehnt', () => {
    expect(SettingsSchema.safeParse(withTimer({ ko128: 600_000 })).success).toBe(false);
  });
});

describe('SettingsPatchSchema (updateSettings, ADR 026)', () => {
  it('Einstellungen: leerer Patch ist zulässig', () => {
    expect(SettingsPatchSchema.safeParse({}).success).toBe(true);
  });

  it('Einstellungen: Teil-Patch von timerByPhase ist zulässig', () => {
    expect(SettingsPatchSchema.safeParse({ timerByPhase: { group: 600_000 } }).success).toBe(true);
  });

  it.each(['semifinal', 'thirdPlace', 'final'] as const)(
    'M12: Patch mit timerByPhase.%s ≠ null wird abgelehnt',
    (stage) => {
      expect(SettingsPatchSchema.safeParse({ timerByPhase: { [stage]: 1 } }).success).toBe(false);
    },
  );

  it('M05: Patch mit groupCount 3 wird abgelehnt', () => {
    expect(SettingsPatchSchema.safeParse({ groupCount: 3 }).success).toBe(false);
  });

  it('Einstellungen: Patch mit unbekanntem Schlüssel wird abgelehnt', () => {
    expect(SettingsPatchSchema.safeParse({ foo: true }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ timerByPhase: { foo: 1 } }).success).toBe(false);
  });
});

describe('STRUCTURAL_SETTINGS (Festlegung Hauptagent / ADR 026)', () => {
  it('M04/M05/M10/S01: ab Start gesperrt sind mode, groupCount, advancersPerGroup, trackCups', () => {
    expect([...STRUCTURAL_SETTINGS].sort()).toEqual(
      ['advancersPerGroup', 'groupCount', 'mode', 'trackCups'].sort(),
    );
  });
});

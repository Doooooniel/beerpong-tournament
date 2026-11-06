// Regeltests aus SPEC „Timer“ (M13), S03 (Vorwarnungen) und Architekturregel 6.
// Reine Funktionen: remainingMs, timerStage, upcomingAlarms. Keine echte Uhr, keine Zufallszahlen.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, remainingMs, timerStage, upcomingAlarms } from '../index.js';
import type { Timer, TimerAlarm, TimerStage } from '../index.js';

const T0 = 1_700_000_000_000;
const MIN = 60_000;
const SEC = 1_000;
const DEFAULT_WARNINGS = [300_000, 60_000, 30_000] as const;

const timer = (patch: Partial<Timer> = {}): Timer => ({
  durationMs: 15 * MIN,
  startedAt: T0,
  pausedAt: null,
  pausedTotalMs: 0,
  ...patch,
});

describe('remainingMs – SPEC Timer (M13, Architekturregel 6)', () => {
  it('Regel 6: Standard-Vorwarnungen sind [300000, 60000, 30000] (S03)', () => {
    expect(DEFAULT_SETTINGS.timerWarningsMs).toEqual([...DEFAULT_WARNINGS]);
  });

  it.each([
    ['direkt beim Start', 0, 15 * MIN],
    ['nach 1 s', SEC, 15 * MIN - SEC],
    ['nach 10 min', 10 * MIN, 5 * MIN],
    ['genau bei Ablauf', 15 * MIN, 0],
  ])('M13 laufend: %s', (_label, elapsed, expected) => {
    expect(remainingMs(timer(), T0 + elapsed)).toBe(expected);
  });

  it('M13 laufend: nach Ablauf wird die Restzeit negativ', () => {
    expect(remainingMs(timer(), T0 + 15 * MIN + 7 * SEC)).toBe(-7 * SEC);
  });

  it('M13 pausiert: Restzeit friert ab pausedAt ein', () => {
    const t = timer({ pausedAt: T0 + 4 * MIN });
    expect(remainingMs(t, T0 + 4 * MIN)).toBe(11 * MIN);
    expect(remainingMs(t, T0 + 9 * MIN)).toBe(11 * MIN);
    expect(remainingMs(t, T0 + 60 * MIN)).toBe(11 * MIN);
  });

  it('M13 mehrfach pausiert: pausedTotalMs wird von der verstrichenen Zeit abgezogen', () => {
    // Zwei frühere Pausen mit zusammen 3 min, jetzt wieder laufend.
    const t = timer({ pausedTotalMs: 3 * MIN });
    expect(remainingMs(t, T0 + 10 * MIN)).toBe(15 * MIN - (10 * MIN - 3 * MIN));
  });

  it('M13 mehrfach pausiert und aktuell erneut pausiert: beide Anteile zählen', () => {
    // Bisherige Pausen 2 min; seit T0+8min erneut pausiert.
    const t = timer({ pausedTotalMs: 2 * MIN, pausedAt: T0 + 8 * MIN });
    // verstrichen aktiv = 8 min − 2 min = 6 min
    expect(remainingMs(t, T0 + 8 * MIN)).toBe(9 * MIN);
    expect(remainingMs(t, T0 + 20 * MIN)).toBe(9 * MIN);
  });

  it('M13 verlängert: größeres durationMs erhöht die Restzeit entsprechend', () => {
    const base = timer();
    const extended = timer({ durationMs: 15 * MIN + 2 * MIN });
    const now = T0 + 5 * MIN;
    expect(remainingMs(extended, now)).toBe((remainingMs(base, now) ?? 0) + 2 * MIN);
  });

  it('M13 verlängert: ein abgelaufener Timer kann durch Verlängerung wieder positiv werden', () => {
    expect(remainingMs(timer({ durationMs: 15 * MIN + MIN }), T0 + 15 * MIN + 30 * SEC)).toBe(
      30 * SEC,
    );
  });

  it('M12: durationMs = null → null (ohne Zeitlimit), auch pausiert', () => {
    expect(remainingMs(timer({ durationMs: null }), T0 + 5 * MIN)).toBeNull();
    expect(
      remainingMs(
        timer({ durationMs: null, pausedAt: T0 + MIN, pausedTotalMs: SEC }),
        T0 + 5 * MIN,
      ),
    ).toBeNull();
  });

  it('SPEC Formel: remaining = duration − (now − startedAt − pausedTotalMs − (now − pausedAt))', () => {
    const t = timer({
      durationMs: 600_000,
      startedAt: 1_000,
      pausedAt: 400_000,
      pausedTotalMs: 50_000,
    });
    const now = 700_000;
    const expected = 600_000 - (now - 1_000 - 50_000 - (now - 400_000));
    expect(remainingMs(t, now)).toBe(expected);
    expect(expected).toBe(251_000);
  });
});

describe('timerStage – S03 Warnstufen', () => {
  it.each<[string, number | null, TimerStage]>([
    ['null → unlimited', null, { kind: 'unlimited' }],
    ['15 min → normal', 15 * MIN, { kind: 'normal' }],
    ['300001 ms → normal', 300_001, { kind: 'normal' }],
    ['genau 300000 → warning 300000', 300_000, { kind: 'warning', thresholdMs: 300_000 }],
    ['299999 → warning 300000', 299_999, { kind: 'warning', thresholdMs: 300_000 }],
    ['60001 → warning 300000', 60_001, { kind: 'warning', thresholdMs: 300_000 }],
    ['genau 60000 → warning 60000', 60_000, { kind: 'warning', thresholdMs: 60_000 }],
    ['45000 → warning 60000', 45_000, { kind: 'warning', thresholdMs: 60_000 }],
    ['30001 → warning 60000', 30_001, { kind: 'warning', thresholdMs: 60_000 }],
    ['genau 30000 → warning 30000', 30_000, { kind: 'warning', thresholdMs: 30_000 }],
    ['1 → warning 30000', 1, { kind: 'warning', thresholdMs: 30_000 }],
    ['0 → expired', 0, { kind: 'expired' }],
    ['−1 → expired', -1, { kind: 'expired' }],
    ['−10 min → expired', -10 * MIN, { kind: 'expired' }],
  ])('S03 Standardschwellen: %s', (_label, remaining, expected) => {
    expect(timerStage(remaining, DEFAULT_WARNINGS)).toEqual(expected);
  });

  it.each<[string, number | null, TimerStage]>([
    ['null → unlimited', null, { kind: 'unlimited' }],
    ['400000 → normal', 400_000, { kind: 'normal' }],
    ['45000 → warning 60000', 45_000, { kind: 'warning', thresholdMs: 60_000 }],
    ['30000 → warning 30000', 30_000, { kind: 'warning', thresholdMs: 30_000 }],
    ['200000 → warning 300000', 200_000, { kind: 'warning', thresholdMs: 300_000 }],
    ['0 → expired', 0, { kind: 'expired' }],
  ])('S03 unsortierte Schwellen [30000, 300000, 60000]: %s', (_label, remaining, expected) => {
    expect(timerStage(remaining, [30_000, 300_000, 60_000])).toEqual(expected);
  });

  it('S03 unsortierte Eingabe wird nicht verändert', () => {
    const warnings = [30_000, 300_000, 60_000];
    timerStage(45_000, warnings);
    expect(warnings).toEqual([30_000, 300_000, 60_000]);
  });

  it.each<[string, number | null, TimerStage]>([
    ['null → unlimited', null, { kind: 'unlimited' }],
    ['15 min → normal', 15 * MIN, { kind: 'normal' }],
    ['1 ms → normal', 1, { kind: 'normal' }],
    ['0 → expired', 0, { kind: 'expired' }],
    ['−5 → expired', -5, { kind: 'expired' }],
  ])('S03 ohne Schwellen []: %s', (_label, remaining, expected) => {
    expect(timerStage(remaining, [])).toEqual(expected);
  });

  it.each<[string, number, TimerStage]>([
    ['120001 → normal', 120_001, { kind: 'normal' }],
    ['120000 → warning 120000', 120_000, { kind: 'warning', thresholdMs: 120_000 }],
    ['1 → warning 120000', 1, { kind: 'warning', thresholdMs: 120_000 }],
  ])('S03 einzelne Schwelle [120000]: %s', (_label, remaining, expected) => {
    expect(timerStage(remaining, [120_000])).toEqual(expected);
  });
});

describe('upcomingAlarms – Timer-Planung (S03, ARCHITECTURE server/timer/scheduler.ts)', () => {
  const warning = (at: number, thresholdMs: number): TimerAlarm => ({
    at,
    kind: 'warning',
    thresholdMs,
  });

  it('S03 frisch gestarteter 15-min-Timer: drei Warnungen und Ablauf, aufsteigend', () => {
    const alarms = upcomingAlarms(timer(), T0, DEFAULT_WARNINGS);
    expect(alarms).toHaveLength(4);
    expect(alarms[0]).toEqual(warning(T0 + 10 * MIN, 300_000));
    expect(alarms[1]).toEqual(warning(T0 + 14 * MIN, 60_000));
    expect(alarms[2]).toEqual(warning(T0 + 14 * MIN + 30 * SEC, 30_000));
    expect(alarms[3]?.at).toBe(T0 + 15 * MIN);
    expect(alarms[3]?.kind).toBe('expired');
    expect(alarms[3]?.thresholdMs).toBeUndefined();
  });

  it('S03 Zeitpunkte = now + (remaining − threshold) bzw. now + remaining, auch mit früheren Pausen', () => {
    const t = timer({ pausedTotalMs: 2 * MIN });
    const now = T0 + 5 * MIN; // remaining = 15 − (5 − 2) = 12 min
    const remaining = 12 * MIN;
    expect(remainingMs(t, now)).toBe(remaining);
    expect(upcomingAlarms(t, now, DEFAULT_WARNINGS)).toEqual([
      warning(now + remaining - 300_000, 300_000),
      warning(now + remaining - 60_000, 60_000),
      warning(now + remaining - 30_000, 30_000),
      { at: now + remaining, kind: 'expired' },
    ]);
  });

  it('S03 bereits vergangene Schwellen fehlen (Restzeit 45 s)', () => {
    const now = T0 + 15 * MIN - 45 * SEC;
    expect(upcomingAlarms(timer(), now, DEFAULT_WARNINGS)).toEqual([
      warning(now + 15 * SEC, 30_000),
      { at: now + 45 * SEC, kind: 'expired' },
    ]);
  });

  it('S03 Restzeit genau auf einer Schwelle: diese Warnung liegt nicht nach now und fehlt', () => {
    const now = T0 + 14 * MIN; // remaining = 60000
    const alarms = upcomingAlarms(timer(), now, DEFAULT_WARNINGS);
    expect(alarms).toEqual([warning(now + 30 * SEC, 30_000), { at: now + MIN, kind: 'expired' }]);
    expect(alarms.every((a) => a.at > now)).toBe(true);
  });

  it('S03 Restzeit unter allen Schwellen: nur noch der Ablauf', () => {
    const now = T0 + 15 * MIN - 10 * SEC;
    expect(upcomingAlarms(timer(), now, DEFAULT_WARNINGS)).toEqual([
      { at: now + 10 * SEC, kind: 'expired' },
    ]);
  });

  it('S03 unsortierte Schwellen ergeben dieselben Alarme aufsteigend nach at', () => {
    const sorted = upcomingAlarms(timer(), T0, DEFAULT_WARNINGS);
    const unsorted = upcomingAlarms(timer(), T0, [30_000, 300_000, 60_000]);
    expect(unsorted).toEqual(sorted);
    const ats = unsorted.map((a) => a.at);
    expect(ats).toEqual([...ats].sort((x, y) => x - y));
  });

  it('S03 ohne Schwellen: nur der Ablauf', () => {
    expect(upcomingAlarms(timer(), T0, [])).toEqual([{ at: T0 + 15 * MIN, kind: 'expired' }]);
  });

  it('S03 Schwelle größer als die Dauer erzeugt keinen Alarm', () => {
    const t = timer({ durationMs: 2 * MIN });
    expect(upcomingAlarms(t, T0, DEFAULT_WARNINGS)).toEqual([
      warning(T0 + MIN, 60_000),
      warning(T0 + 90 * SEC, 30_000),
      { at: T0 + 2 * MIN, kind: 'expired' },
    ]);
  });

  it('S03 pausierter Timer → []', () => {
    const t = timer({ pausedAt: T0 + MIN });
    expect(upcomingAlarms(t, T0 + 2 * MIN, DEFAULT_WARNINGS)).toEqual([]);
  });

  it('M12 ohne Zeitlimit → []', () => {
    expect(upcomingAlarms(timer({ durationMs: null }), T0, DEFAULT_WARNINGS)).toEqual([]);
  });

  it.each([
    ['genau abgelaufen', 15 * MIN],
    ['seit 1 min abgelaufen', 16 * MIN],
  ])('S03 abgelaufener Timer (%s) → []', (_label, elapsed) => {
    expect(upcomingAlarms(timer(), T0 + elapsed, DEFAULT_WARNINGS)).toEqual([]);
  });

  it('M13 verlängerter Timer: Alarme verschieben sich um die Verlängerung', () => {
    const now = T0 + 5 * MIN;
    const base = upcomingAlarms(timer(), now, DEFAULT_WARNINGS);
    const extended = upcomingAlarms(timer({ durationMs: 17 * MIN }), now, DEFAULT_WARNINGS);
    expect(extended).toEqual(base.map((a) => ({ ...a, at: a.at + 2 * MIN })));
  });
});

import { describe, it, expect } from 'vitest';
import {
  getDefaultICLineConfig,
  getDefaultNICLineConfig,
  getAreaIds,
  getRosterAreaIds,
  getFloatSlots,
  getLineSections,
  getLeadSlotKeys,
} from './lineConfig';

describe('IC default line config (post Flip-as-floats)', () => {
  const ic = getDefaultICLineConfig();

  it('has the 6 station areas in display order', () => {
    expect(ic.areas.map((a) => a.id)).toEqual([
      'area_14_5',
      'area_courtyard',
      'area_bonding',
      'area_testing',
      'area_potting',
      'area_end_of_line',
    ]);
  });

  it('does NOT include area_flip as a station', () => {
    expect(ic.areas.find((a) => a.id === 'area_flip')).toBeUndefined();
  });

  it('uses the new capacities (14.5=2/2, Courtyard 4-5, Bonding 8-10, Testing 1, Potting 2-3, EOL 3)', () => {
    const cap = Object.fromEntries(ic.areas.map((a) => [a.id, { min: a.minSlots, max: a.maxSlots }]));
    expect(cap).toEqual({
      area_14_5: { min: 2, max: 2 },
      area_courtyard: { min: 4, max: 5 },
      area_bonding: { min: 8, max: 10 },
      area_testing: { min: 1, max: 1 },
      area_potting: { min: 2, max: 3 },
      area_end_of_line: { min: 3, max: 3 },
    });
  });

  it('has a 10-entry default slot label list for Bonding without a Float position', () => {
    const bonding = ic.areas.find((a) => a.id === 'area_bonding');
    expect(bonding?.defaultSlotLabels).toEqual([
      '100s',
      '100s/200s',
      '100s/200s',
      '200s/300s',
      '200s/300s',
      '300s/400s',
      '300s/400s',
      '400/s',
      'Rework',
      'Manual Review',
    ]);
  });

  it('exposes 2 Flip floats that cover 14.5 and Testing', () => {
    const floats = getFloatSlots(ic);
    expect(floats).toHaveLength(2);
    expect(floats.map((f) => f.id).sort()).toEqual(['flip_1', 'flip_2']);
    for (const f of floats) {
      expect(f.supportedAreaIds.sort()).toEqual(['area_14_5', 'area_testing']);
    }
  });

  it('drops the legacy [14.5, Flip] combinedSection (Flip is no longer an area)', () => {
    expect(ic.combinedSections).toEqual([]);
    const sections = getLineSections(ic);
    // Sections should be the 6 single areas, no nested arrays.
    expect(sections.every((s) => typeof s === 'string')).toBe(true);
    expect(sections).toHaveLength(6);
  });

  it('keeps the 3 lead roles (End Of Line, Courtyard, Bonding)', () => {
    expect(getLeadSlotKeys(ic).sort()).toEqual(['area_bonding', 'area_courtyard', 'area_end_of_line']);
  });

  it('full-staff target is 29 (3 leads + 20 station mins + 2 floats + 4 elastic max-out)', () => {
    const minSum = ic.areas.reduce((s, a) => s + a.minSlots, 0);
    const maxSum = ic.areas.reduce((s, a) => s + a.maxSlots, 0);
    const leads = getLeadSlotKeys(ic).length;
    const floats = getFloatSlots(ic).length;
    expect(minSum).toBe(20);
    expect(leads + minSum + floats).toBe(25); // when stations run at minimum
    expect(leads + maxSum + floats).toBe(29); // fully staffed: max stations + leads + floats
  });
});

describe('NIC default line config', () => {
  it('mirrors IC structurally so people can flex between lines', () => {
    const ic = getDefaultICLineConfig();
    const nic = getDefaultNICLineConfig();
    expect(nic.areas.map((a) => a.id)).toEqual(ic.areas.map((a) => a.id));
    expect(getFloatSlots(nic).map((f) => f.id)).toEqual(getFloatSlots(ic).map((f) => f.id));
    expect(getLeadSlotKeys(nic)).toEqual(getLeadSlotKeys(ic));
  });
});

describe('getAreaIds / getRosterAreaIds with floats', () => {
  it('returns station areas first, then float ids', () => {
    const ic = getDefaultICLineConfig();
    const ids = getAreaIds(ic);
    const stationCount = ic.areas.length;
    expect(ids.slice(0, stationCount)).toEqual(ic.areas.map((a) => a.id));
    expect(ids.slice(stationCount)).toEqual(['flip_1', 'flip_2']);
    // Roster ordering should match for the no-combined-sections case.
    expect(getRosterAreaIds(ic)).toEqual(ids);
  });
});

import { describe, it, expect } from 'vitest';
import {
  desdeElNavegador,
  esFecha,
  esPeriodo,
  haciaElNavegador,
  nombreDelPeriodo,
  periodoAnterior,
  periodoEnRD,
  periodoSiguiente,
  ultimoDiaDelPeriodo,
} from './fechas';

describe('fechas del 606', () => {
  it('acepta una fecha AAAAMMDD que existe', () => {
    expect(esFecha('20260913')).toBe(true);
    expect(esFecha('20240229')).toBe(true);
  });

  it('rechaza fechas que no existen o que traen otro formato', () => {
    for (const valor of ['20260931', '20250229', '2026-09-13', '13-09-2026', '2026091', '']) {
      expect(esFecha(valor)).toBe(false);
    }
  });

  // El formato vigente del 606 rige desde el periodo mayo de 2018.
  it('acepta periodos AAAAMM desde mayo de 2018', () => {
    expect(esPeriodo('201805')).toBe(true);
    expect(esPeriodo('202609')).toBe(true);
    for (const valor of ['201804', '202613', '202600', '2026-09', '']) {
      expect(esPeriodo(valor)).toBe(false);
    }
  });

  it('da el último día del periodo', () => {
    expect(ultimoDiaDelPeriodo('202602')).toBe('20260228');
    expect(ultimoDiaDelPeriodo('202402')).toBe('20240229');
    expect(ultimoDiaDelPeriodo('202609')).toBe('20260930');
  });

  it('pasa entre la fecha del navegador y AAAAMMDD', () => {
    expect(desdeElNavegador('2026-09-13')).toBe('20260913');
    expect(haciaElNavegador('20260913')).toBe('2026-09-13');
    expect(() => desdeElNavegador('13/09/2026')).toThrow(/Fecha inválida/);
  });

  // República Dominicana está en GMT-4 todo el año.
  it('da el periodo en la hora de República Dominicana', () => {
    expect(periodoEnRD(new Date('2026-10-01T02:00:00Z'))).toBe('202609');
    expect(periodoEnRD(new Date('2026-10-01T05:00:00Z'))).toBe('202610');
  });

  it('mueve el periodo un mes', () => {
    expect(periodoAnterior('202601')).toBe('202512');
    expect(periodoSiguiente('202612')).toBe('202701');
  });

  it('nombra el periodo en español', () => {
    expect(nombreDelPeriodo('202609')).toBe('septiembre de 2026');
  });
});

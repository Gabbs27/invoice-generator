import { describe, it, expect } from 'vitest';
import { aCentavos, aMonto, esMonto } from './montos';

describe('montos del 606', () => {
  // NG 07-2018, Anexo A: los montos del 606 son N 12, con punto decimal.
  it('acepta hasta nueve enteros y dos decimales, con punto', () => {
    for (const valor of ['0', '1500', '1500.5', '1500.50', '999999999.99']) {
      expect(esMonto(valor)).toBe(true);
    }
  });

  it('rechaza lo que no cabe o no es un monto', () => {
    for (const valor of ['', '-1', '1,500.00', '1500.505', '1000000000.00', '.50', '1e3', ' 15']) {
      expect(esMonto(valor)).toBe(false);
    }
  });

  it('pasa a centavos sin punto flotante', () => {
    expect(aCentavos('1500.5', 'ITBIS facturado')).toBe(BigInt(150050));
    expect(aCentavos('0.07', 'ITBIS facturado')).toBe(BigInt(7));
  });

  it('dice qué campo tiene el monto inválido', () => {
    expect(() => aCentavos('1,500', 'Monto facturado en bienes')).toThrow(
      /Monto facturado en bienes inválido: 1,500/
    );
  });

  it('escribe los centavos con dos decimales', () => {
    expect(aMonto(BigInt(150050))).toBe('1500.50');
    expect(aMonto(BigInt(7))).toBe('0.07');
    expect(aMonto(BigInt(0))).toBe('0.00');
  });
});

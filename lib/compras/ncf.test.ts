import { describe, it, expect } from 'vitest';
import { leerNCFDeCompra, tieneFormaDeNCF } from './ncf';

describe('NCF de compras', () => {
  it('acepta una factura de crédito fiscal de serie B y un e-CF', () => {
    expect(leerNCFDeCompra('B0100000123')).toEqual({ valido: true, esNota: false });
    expect(leerNCFDeCompra('E310000000456')).toEqual({ valido: true, esNota: false });
  });

  it('reconoce las notas de débito y de crédito', () => {
    for (const ncf of ['B0300000001', 'B0400000001', 'E330000000001', 'E340000000001']) {
      expect(leerNCFDeCompra(ncf)).toEqual({ valido: true, esNota: true });
    }
  });

  it('rechaza las facturas de consumo', () => {
    for (const ncf of ['B0200000001', 'E320000000001']) {
      expect(leerNCFDeCompra(ncf)).toEqual({
        valido: false,
        motivo: expect.stringMatching(/factura de consumo/),
      });
    }
  });

  it('rechaza los tipos que el 606 no admite', () => {
    expect(leerNCFDeCompra('B1200000001')).toEqual({
      valido: false,
      motivo: expect.stringMatching(/no admite/),
    });
    expect(leerNCFDeCompra('E990000000001')).toEqual({
      valido: false,
      motivo: expect.stringMatching(/no admite/),
    });
  });

  it('rechaza lo que no tiene la forma de un NCF', () => {
    for (const ncf of ['B010000001', 'E31000000001', 'b0100000123', 'A010010010000000001', '']) {
      expect(tieneFormaDeNCF(ncf)).toBe(false);
      expect(leerNCFDeCompra(ncf)).toEqual({
        valido: false,
        motivo: expect.stringMatching(/NCF inválido/),
      });
    }
  });
});

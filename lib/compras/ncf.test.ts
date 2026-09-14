import { describe, it, expect } from 'vitest';
import { esGastoMenor, leerNCFDeCompra, tieneFormaDeNCF } from './ncf';

describe('NCF de compras', () => {
  it('acepta una factura de crédito fiscal de serie B y un e-CF', () => {
    expect(leerNCFDeCompra('B0100000123')).toEqual({ valido: true, esNota: false });
    expect(leerNCFDeCompra('E310000000456')).toEqual({ valido: true, esNota: false });
  });

  it('acepta los demás tipos que acepta la herramienta 606', () => {
    const tipos = ['B11', 'B12', 'B13', 'B14', 'B15', 'B17', 'E41', 'E43', 'E44', 'E45', 'E47'];
    for (const tipo of tipos) {
      const ncf = tipo.startsWith('B') ? `${tipo}00000001` : `${tipo}0000000001`;
      expect(leerNCFDeCompra(ncf)).toEqual({ valido: true, esNota: false });
    }
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

  // La expresión regular de la herramienta 606 no acepta B16 ni E46, que son de exportaciones. E42
  // no es un tipo de e-CF.
  it('rechaza los tipos que el 606 no admite', () => {
    for (const ncf of ['B1600000001', 'E420000000001', 'E460000000001', 'E990000000001']) {
      expect(leerNCFDeCompra(ncf)).toEqual({
        valido: false,
        motivo: expect.stringMatching(/no admite/),
      });
    }
  });

  it('reconoce los comprobantes de gastos menores', () => {
    expect(esGastoMenor('B1300000001')).toBe(true);
    expect(esGastoMenor('E430000000001')).toBe(true);
    expect(esGastoMenor('B0100000001')).toBe(false);
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

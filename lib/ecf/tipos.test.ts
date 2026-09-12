import { describe, it, expect } from 'vitest';
import { TIPOS_ECF, nombreTipo, esTipoValido } from './tipos';

describe('tipos de e-CF', () => {
  it('conoce los diez tipos publicados por DGII', () => {
    expect(Object.keys(TIPOS_ECF)).toEqual(
      ['31', '32', '33', '34', '41', '43', '44', '45', '46', '47']
    );
  });

  it('nombra el tipo 31 como Factura de Crédito Fiscal Electrónica', () => {
    expect(nombreTipo('31')).toBe('Factura de Crédito Fiscal Electrónica');
  });

  it('rechaza un tipo que no existe', () => {
    expect(esTipoValido('99')).toBe(false);
  });

  // Control: `in` también encuentra las claves que todo objeto hereda de Object.prototype.
  it.each(['constructor', 'toString', '__proto__'])(
    'no confunde %s, heredado de Object.prototype, con un tipo',
    (clave) => {
      expect(esTipoValido(clave)).toBe(false);
    }
  );
});

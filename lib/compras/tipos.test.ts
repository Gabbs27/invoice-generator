import { describe, it, expect } from 'vitest';
import { compraDePrueba } from './ejemplos';
import {
  claveDeCompra,
  esClaveDeCompra,
  esCodigo,
  esCompra,
  exigirClaveDeCompra,
  FORMAS_DE_PAGO,
  TIPOS_DE_BIENES_Y_SERVICIOS,
  TIPOS_DE_RETENCION_ISR,
} from './tipos';

describe('tipos de la compra', () => {
  // Instructivo del 606, casillas 3, 17 y 23.
  it('tiene los códigos del instructivo del 606', () => {
    expect(Object.keys(TIPOS_DE_BIENES_Y_SERVICIOS)).toHaveLength(11);
    expect(Object.keys(TIPOS_DE_RETENCION_ISR)).toHaveLength(9);
    expect(Object.keys(FORMAS_DE_PAGO)).toHaveLength(7);
    expect(esCodigo(FORMAS_DE_PAGO, '7')).toBe(true);
    expect(esCodigo(FORMAS_DE_PAGO, '8')).toBe(false);
  });

  it('usa el proveedor y el NCF como llave', () => {
    expect(claveDeCompra(compraDePrueba())).toBe('987654321_B0100000123');
  });

  it('reconoce una clave de compra', () => {
    for (const clave of ['987654321_B0100000123', '00100000001_E310000000001']) {
      expect(esClaveDeCompra(clave)).toBe(true);
    }
  });

  // La clave termina en un nombre de archivo.
  it('rechaza lo que no es una clave de compra', () => {
    for (const clave of ['../emisor', '98765432_B0100000123', '987654321_b0100000123', '987654321_B01']) {
      expect(esClaveDeCompra(clave)).toBe(false);
    }
    expect(() => exigirClaveDeCompra('../emisor')).toThrow(/Clave de compra inválida/);
  });
});

describe('forma de una compra', () => {
  it('reconoce una compra, con o sin los campos opcionales', () => {
    expect(esCompra(compraDePrueba())).toBe(true);
    expect(esCompra(compraDePrueba({ FechaPago: '20260905', PropinaLegal: '100.00' }))).toBe(true);
  });

  it('rechaza lo que no tiene la forma de una compra', () => {
    const sinNCF: Record<string, unknown> = { ...compraDePrueba() };
    delete sinNCF.NCF;
    const valores = [
      null,
      'compra',
      [],
      sinNCF,
      { ...compraDePrueba(), MontoBienes: 0 },
      { ...compraDePrueba(), PropinaLegal: 10 },
      { ...compraDePrueba(), Proveedor: 'Ferretería Inventada' },
    ];
    for (const valor of valores) expect(esCompra(valor)).toBe(false);
  });
});

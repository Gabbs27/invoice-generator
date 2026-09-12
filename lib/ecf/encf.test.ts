import { describe, it, expect } from 'vitest';
import { construirENCF, parsearENCF, esENCFValido } from './encf';

describe('e-NCF', () => {
  it('construye trece caracteres: E, tipo, secuencia en diez dígitos', () => {
    const encf = construirENCF('31', 1);
    expect(encf).toBe('E310000000001');
    expect(encf).toHaveLength(13);
  });

  it('no trunca una secuencia de diez dígitos', () => {
    expect(construirENCF('32', 9_999_999_999)).toBe('E329999999999');
  });

  it('rechaza una secuencia que no cabe en diez dígitos', () => {
    expect(() => construirENCF('31', 10_000_000_000)).toThrow(/diez dígitos/);
  });

  it('rechaza la secuencia cero: DGII numera desde 1', () => {
    expect(() => construirENCF('31', 0)).toThrow();
  });

  it('parsea de vuelta al tipo y la secuencia', () => {
    expect(parsearENCF('E340000012345')).toEqual({ tipo: '34', secuencia: 12345 });
  });

  // El control negativo: lo que NO es un e-NCF.
  it.each([
    ['B0100000001', 'un NCF viejo de once caracteres'],
    ['E31000000001', 'doce caracteres'],
    ['E3100000000012', 'catorce caracteres'],
    ['X310000000001', 'no empieza con E'],
    ['E990000000001', 'tipo inexistente'],
    ['E31000000000A', 'secuencia no numérica'],
  ])('rechaza %s (%s)', (valor) => {
    expect(esENCFValido(valor)).toBe(false);
  });
});

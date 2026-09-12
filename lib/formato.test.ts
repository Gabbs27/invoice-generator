import { describe, it, expect } from 'vitest';
import { conMiles } from './formato';

describe('montos para leer', () => {
  it('separa los miles con coma y deja los decimales como vienen', () => {
    expect(conMiles('1234567.50')).toBe('1,234,567.50');
    expect(conMiles('1250.0000')).toBe('1,250.0000');
  });

  it('no separa lo que no llega a mil', () => {
    expect(conMiles('999.99')).toBe('999.99');
  });

  // El XML guarda el precio como se escribió: puede venir sin decimales.
  it('un monto sin decimales sigue sin decimales', () => {
    expect(conMiles('1180')).toBe('1,180');
  });
});

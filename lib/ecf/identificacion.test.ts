import { describe, it, expect } from 'vitest';
import { tipoIdentificacion, esIdentificacionValida } from './identificacion';

describe('RNC y cédula', () => {
  it('reconoce nueve dígitos como RNC', () => {
    expect(tipoIdentificacion('123456789')).toBe('RNC');
    expect(esIdentificacionValida('123456789')).toBe(true);
  });

  it('reconoce once dígitos como cédula', () => {
    expect(tipoIdentificacion('12345678901')).toBe('cedula');
    expect(esIdentificacionValida('12345678901')).toBe(true);
  });

  // Una cédula guardada como número en un JSON pierde los ceros de la izquierda:
  // 00123456789 llega como 123456789 y pasaría por un RNC.
  it('rechaza un número en vez de texto', () => {
    expect(tipoIdentificacion(123456789 as unknown as string)).toBeNull();
  });

  // El control negativo: lo que RNCValidationType rechaza.
  it.each([
    ['', 'vacío'],
    ['12345678', 'ocho dígitos'],
    ['1234567890', 'diez dígitos'],
    ['123456789012', 'doce dígitos'],
    ['1-23-45678-9', 'con guiones'],
    [' 123456789', 'con un espacio delante'],
    ['123456789\n', 'con un salto de línea detrás'],
    ['12345678A', 'con una letra'],
  ])('rechaza %j (%s)', (valor) => {
    expect(tipoIdentificacion(valor)).toBeNull();
    expect(esIdentificacionValida(valor)).toBe(false);
  });
});

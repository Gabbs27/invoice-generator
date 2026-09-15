import { describe, it, expect } from 'vitest';
import { esCedulaValida, esRNCValido, revisarRNC } from './digitoVerificador';

// Números inventados. El dígito verificador es el de las macros de la herramienta 606 de la DGII.
describe('dígito verificador', () => {
  it('reconoce un RNC con su dígito verificador', () => {
    expect(esRNCValido('130000001')).toBe(true);
    expect(esRNCValido('100000004')).toBe(true);
    for (const valor of ['130000002', '100000009', '13000000', '1300000011', '13000000A']) {
      expect(esRNCValido(valor)).toBe(false);
    }
  });

  it('reconoce una cédula con su dígito verificador', () => {
    for (const valor of ['00100000009', '01000000008', '40200000004']) {
      expect(esCedulaValida(valor)).toBe(true);
    }
    for (const valor of ['40200000005', '0010000000', '001000000090']) {
      expect(esCedulaValida(valor)).toBe(false);
    }
  });

  it('deja pasar un RNC o una cédula válidos', () => {
    expect(revisarRNC('130000001')).toEqual({ estado: 'valido' });
    expect(revisarRNC('40200000004')).toEqual({ estado: 'valido' });
  });

  // Excel guarda el número sin los ceros de la izquierda: una cédula que empieza con 00 llega con 9
  // dígitos, y una que empieza con un solo 0, con 10.
  it('propone la cédula de un número que perdió los ceros', () => {
    expect(revisarRNC('100000009')).toEqual({ estado: 'cedula', cedula: '00100000009' });
    expect(revisarRNC('1000000008')).toEqual({ estado: 'cedula', cedula: '01000000008' });
  });

  it('no toca un RNC válido aunque con ceros también sea una cédula válida', () => {
    expect(revisarRNC('140000001')).toEqual({ estado: 'valido' });
  });

  it('marca como dudoso un RNC o una cédula con el dígito verificador mal', () => {
    expect(revisarRNC('100000000')).toEqual({ estado: 'dudoso' });
    expect(revisarRNC('40200000005')).toEqual({ estado: 'dudoso' });
  });

  // El largo lo revisa validarCompra, con su propio mensaje.
  it('no opina de lo que no es un RNC, una cédula ni una cédula sin ceros', () => {
    for (const valor of ['', '12345678', '123456789012', '1000000009', 'RNC']) {
      expect(revisarRNC(valor)).toEqual({ estado: 'otro' });
    }
  });
});

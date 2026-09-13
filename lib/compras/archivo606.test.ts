import { describe, it, expect } from 'vitest';
import { archivo606, MAXIMO_DE_REGISTROS, nombreDelArchivo606 } from './archivo606';
import { compraDePrueba } from './ejemplos';

describe('el archivo 606', () => {
  it('se llama como lo nombra la herramienta de la DGII', () => {
    expect(nombreDelArchivo606('123456789', '202609')).toBe('DGII_F_606_123456789_202609.TXT');
  });

  // Las 23 casillas en el orden de la NG 07-2018, Anexo A, escritas como en los archivos de la
  // herramienta de la DGII que la Oficina Virtual aceptó.
  it('escribe el encabezado y una línea por compra, cada una terminada en LF', () => {
    const nota = compraDePrueba({
      RNCCedula: '00100000001',
      TipoBienesServicios: '3',
      NCF: 'E340000000007',
      NCFModificado: 'E310000000456',
      FechaComprobante: '20260910',
      FechaPago: '20260915',
      MontoServicios: '25000',
      MontoBienes: '0',
      ITBISFacturado: '4500',
      ITBISRetenido: '4500',
      ITBISCosto: '500.5',
      TipoRetencionISR: '1',
      MontoRetencionRenta: '2500',
      OtrosImpuestos: '10',
      PropinaLegal: '2500',
      FormaPago: '2',
    });
    expect(archivo606('123456789', '202609', [compraDePrueba(), nota])).toBe(
      '606|123456789|202609|2\n' +
        '987654321|1|02|B0100000123||20260905||1000.00||1000.00|180.00||||180.00||||||||01\n' +
        '00100000001|2|03|E340000000007|E310000000456|20260910|20260915|25000.00||25000.00|4500.00|4500.00||500.50|3999.50||01|2500.00|||10.00|2500.00|02\n'
    );
  });

  it('deja vacío un monto en cero', () => {
    const exenta = compraDePrueba({ MontoServicios: '0', MontoBienes: '1000', ITBISFacturado: '0.00' });
    expect(archivo606('123456789', '202609', [exenta])).toBe(
      '606|123456789|202609|1\n' +
        '987654321|1|02|B0100000123||20260905|||1000.00|1000.00|||||||||||||01\n'
    );
  });

  it('rechaza un mes sin compras', () => {
    expect(() => archivo606('123456789', '202609', [])).toThrow(/en cero/);
  });

  it('rechaza más compras de las que admite un archivo', () => {
    const compras = Array.from({ length: MAXIMO_DE_REGISTROS + 1 }, () => compraDePrueba());
    expect(() => archivo606('123456789', '202609', compras)).toThrow(/hasta 10000/);
  });

  it('rechaza un periodo inválido', () => {
    expect(() => archivo606('123456789', '2026-09', [compraDePrueba()])).toThrow(/Periodo inválido/);
  });
});

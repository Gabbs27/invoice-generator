import { describe, it, expect } from 'vitest';
import {
  centavosDeExcel,
  digitosDeExcel,
  fechaDeExcel,
  formaDePagoDelTexto,
  historialDeProveedores,
  montoDeLaCelda,
  normalizar,
} from './desdeExcel';
import { compraDePrueba } from './ejemplos';
import type { FormaPago } from './tipos';

describe('valores de Excel', () => {
  it('normaliza etiquetas sin mayúsculas, tildes ni espacios', () => {
    expect(normalizar(' Método de  pago ')).toBe('metododepago');
    expect(normalizar('10% ley')).toBe('10%ley');
    expect(normalizar('SEPTIEMBRE')).toBe('septiembre');
  });

  // En el XML, Excel guarda los dígitos que hagan falta, a veces en notación científica.
  it('lleva un número de Excel a centavos, con la mitad hacia arriba', () => {
    expect(centavosDeExcel('1234.5')).toBe(BigInt(123450));
    expect(centavosDeExcel('212.39999999999998')).toBe(BigInt(21240));
    expect(centavosDeExcel('1.30000001E8')).toBe(BigInt(13000000100));
    expect(centavosDeExcel('0.005')).toBe(BigInt(1));
    expect(centavosDeExcel('5E-3')).toBe(BigInt(1));
    expect(centavosDeExcel('2.5E-3')).toBe(BigInt(0));
    expect(centavosDeExcel('-12')).toBe(BigInt(-1200));
    for (const valor of ['', 'abc', '1e', '1,234.50']) {
      expect(centavosDeExcel(valor)).toBeUndefined();
    }
  });

  it('lee un monto: vacío es cero y un texto no se lee', () => {
    expect(montoDeLaCelda(undefined)).toBe(BigInt(0));
    expect(montoDeLaCelda({ tipo: 'texto', valor: '  ' })).toBe(BigInt(0));
    expect(montoDeLaCelda({ tipo: 'numero', valor: '118' })).toBe(BigInt(11800));
    expect(montoDeLaCelda({ tipo: 'texto', valor: 'RD$118' })).toBeUndefined();
  });

  it('saca los dígitos del RNC, venga como número o como texto', () => {
    expect(digitosDeExcel({ tipo: 'numero', valor: '1.30000001E8' })).toBe('130000001');
    expect(digitosDeExcel({ tipo: 'texto', valor: '1-30-00000-1' })).toBe('130000001');
    expect(digitosDeExcel({ tipo: 'texto', valor: '001 0000000 9' })).toBe('00100000009');
    expect(digitosDeExcel({ tipo: 'numero', valor: '130000001.5' })).toBe('130000001.5');
    expect(digitosDeExcel(undefined)).toBe('');
  });

  // 46270 es el 5 de septiembre de 2026 contando desde 1900, y 44808 contando desde 1904.
  it('lleva una fecha de Excel a AAAAMMDD', () => {
    expect(fechaDeExcel({ tipo: 'numero', valor: '46270' }, false)).toBe('20260905');
    expect(fechaDeExcel({ tipo: 'numero', valor: '46270.75' }, false)).toBe('20260905');
    expect(fechaDeExcel({ tipo: 'numero', valor: '44808' }, true)).toBe('20260905');
    expect(fechaDeExcel({ tipo: 'texto', valor: '05/09/2026' }, false)).toBeUndefined();
    expect(fechaDeExcel(undefined, false)).toBeUndefined();
  });

  it('reconoce la forma de pago por su nombre', () => {
    expect(formaDePagoDelTexto('Efectivo')).toBe('1');
    expect(formaDePagoDelTexto('Cheques/Transferencias/Depósito')).toBe('2');
    expect(formaDePagoDelTexto('03 - TARJETA CRÉDITO/DÉBITO')).toBe('3');
    expect(formaDePagoDelTexto('Compra a crédito')).toBe('4');
    expect(formaDePagoDelTexto('Permuta')).toBe('5');
    expect(formaDePagoDelTexto('Notas de crédito')).toBe('6');
    expect(formaDePagoDelTexto('Mixto')).toBe('7');
    expect(formaDePagoDelTexto('')).toBeUndefined();
    expect(formaDePagoDelTexto('Pagado')).toBeUndefined();
  });
});

describe('historial de proveedores', () => {
  it('toma el tipo, la clase y la forma de pago de la compra más reciente de cada proveedor', () => {
    const historial = historialDeProveedores([
      compraDePrueba({ RNCCedula: '130000001', FechaComprobante: '20260805' }),
      compraDePrueba({
        RNCCedula: '130000001',
        NCF: 'B0100000124',
        FechaComprobante: '20260812',
        TipoBienesServicios: '9',
        MontoServicios: '0.00',
        MontoBienes: '500.00',
        FormaPago: '3',
      }),
      compraDePrueba({ RNCCedula: '100000004', FechaComprobante: '20260701' }),
    ]);
    expect(historial).toEqual({
      '130000001': { tipo: '9', clase: 'bienes', forma: '3' },
      '100000004': { tipo: '2', clase: 'servicios', forma: '1' },
    });
  });

  // Un archivo de datos/compras editado a mano puede traer códigos que no existen.
  it('no toma una compra con códigos que no existen', () => {
    const historial = historialDeProveedores([
      compraDePrueba({ RNCCedula: '130000001', FechaComprobante: '20260805' }),
      compraDePrueba({
        RNCCedula: '130000001',
        NCF: 'B0100000124',
        FechaComprobante: '20260812',
        FormaPago: '8' as FormaPago,
      }),
    ]);
    expect(historial['130000001']).toEqual({ tipo: '2', clase: 'servicios', forma: '1' });
  });
});

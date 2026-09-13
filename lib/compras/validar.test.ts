import { describe, it, expect } from 'vitest';
import { compraDePrueba } from './ejemplos';
import type { FormaPago, TipoBienesServicios } from './tipos';
import { validarCompra } from './validar';

describe('validar una compra', () => {
  it('acepta una compra completa', () => {
    expect(validarCompra(compraDePrueba())).toEqual([]);
  });

  it('acepta una cédula de proveedor', () => {
    expect(validarCompra(compraDePrueba({ RNCCedula: '00100000001' }))).toEqual([]);
  });

  it('rechaza un RNC que no tiene 9 u 11 dígitos', () => {
    expect(validarCompra(compraDePrueba({ RNCCedula: '12345678' }))).toEqual([
      expect.stringMatching(/RNC o cédula del proveedor inválido.*9 u 11/),
    ]);
  });

  it('rechaza un tipo de bienes y servicios fuera del 1 al 11', () => {
    expect(validarCompra(compraDePrueba({ TipoBienesServicios: '12' as TipoBienesServicios }))).toEqual([
      expect.stringMatching(/Tipo de bienes y servicios inválido/),
    ]);
  });

  it('rechaza una factura de consumo', () => {
    expect(validarCompra(compraDePrueba({ NCF: 'B0200000001' }))).toEqual([
      expect.stringMatching(/factura de consumo/),
    ]);
  });

  it('pide el NCF modificado en una nota', () => {
    expect(validarCompra(compraDePrueba({ NCF: 'B0400000007' }))).toEqual([
      expect.stringMatching(/lleva el NCF que modifica/),
    ]);
  });

  it('acepta una nota con su NCF modificado', () => {
    expect(validarCompra(compraDePrueba({ NCF: 'E340000000007', NCFModificado: 'E310000000456' }))).toEqual([]);
  });

  it('no admite el NCF modificado fuera de una nota', () => {
    expect(validarCompra(compraDePrueba({ NCFModificado: 'B0100000001' }))).toEqual([
      expect.stringMatching(/solo en notas/),
    ]);
  });

  it('rechaza una fecha del comprobante que no existe', () => {
    expect(validarCompra(compraDePrueba({ FechaComprobante: '20260931' }))).toEqual([
      expect.stringMatching(/Fecha del comprobante inválida/),
    ]);
  });

  it('rechaza cada monto con coma o con más de dos decimales', () => {
    expect(validarCompra(compraDePrueba({ MontoServicios: '1,000.00', ITBISFacturado: '180.005' }))).toEqual([
      expect.stringMatching(/Monto facturado en servicios inválido/),
      expect.stringMatching(/ITBIS facturado inválido/),
    ]);
  });

  it('rechaza una compra sin monto', () => {
    expect(validarCompra(compraDePrueba({ MontoServicios: '0', MontoBienes: '0.00' }))).toEqual([
      expect.stringMatching(/no tiene monto/),
    ]);
  });

  it('rechaza un total que no cabe en el 606', () => {
    expect(validarCompra(compraDePrueba({ MontoServicios: '999999999.99', MontoBienes: '0.01' }))).toEqual([
      expect.stringMatching(/no cabe en el 606/),
    ]);
  });

  it('no deja que el ITBIS llevado al costo pase del facturado', () => {
    expect(validarCompra(compraDePrueba({ ITBISCosto: '180.01' }))).toEqual([
      expect.stringMatching(/llevado al costo/),
    ]);
  });

  it('pide la fecha de pago con una retención de ITBIS', () => {
    expect(validarCompra(compraDePrueba({ ITBISRetenido: '54.00' }))).toEqual([
      expect.stringMatching(/fecha de pago/),
    ]);
  });

  it('pide la fecha de pago y el tipo con una retención de ISR', () => {
    expect(validarCompra(compraDePrueba({ MontoRetencionRenta: '100.00' }))).toEqual([
      expect.stringMatching(/fecha de pago/),
      expect.stringMatching(/tipo de retención/),
    ]);
  });

  it('acepta una retención de ISR completa', () => {
    expect(
      validarCompra(compraDePrueba({ MontoRetencionRenta: '100.00', TipoRetencionISR: '2', FechaPago: '20260920' }))
    ).toEqual([]);
  });

  it('no acepta un tipo de retención sin monto retenido', () => {
    expect(validarCompra(compraDePrueba({ TipoRetencionISR: '1' }))).toEqual([
      expect.stringMatching(/va con un monto retenido/),
    ]);
  });

  it('rechaza una forma de pago fuera del 1 al 7', () => {
    expect(validarCompra(compraDePrueba({ FormaPago: '8' as FormaPago }))).toEqual([
      expect.stringMatching(/Forma de pago inválida/),
    ]);
  });
});

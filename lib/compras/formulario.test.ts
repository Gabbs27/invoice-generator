import { describe, it, expect } from 'vitest';
import { leerCompraDelFormulario } from './formulario';

function formulario(campos: Record<string, string>): FormData {
  const datos = new FormData();
  for (const [campo, valor] of Object.entries(campos)) datos.append(campo, valor);
  return datos;
}

const anotada = {
  RNCCedula: ' 987-654-321 ',
  TipoBienesServicios: '2',
  NCF: 'b0100000123',
  NCFModificado: '',
  FechaComprobante: '2026-09-05',
  FechaPago: '2026-09-20',
  MontoServicios: '1000.00',
  MontoBienes: '',
  ITBISFacturado: '180.00',
  ITBISRetenido: '54.00',
  ITBISProporcionalidad: '',
  ITBISCosto: '',
  TipoRetencionISR: '2',
  MontoRetencionRenta: '100.00',
  ImpuestoSelectivo: '',
  OtrosImpuestos: '',
  PropinaLegal: '',
  FormaPago: '2',
};

describe('leer el formulario de compra', () => {
  it('lee una compra anotada a mano', () => {
    expect(leerCompraDelFormulario(formulario(anotada))).toEqual({
      RNCCedula: '987654321',
      TipoBienesServicios: '2',
      NCF: 'B0100000123',
      FechaComprobante: '20260905',
      FechaPago: '20260920',
      MontoServicios: '1000.00',
      MontoBienes: '0',
      ITBISFacturado: '180.00',
      ITBISRetenido: '54.00',
      TipoRetencionISR: '2',
      MontoRetencionRenta: '100.00',
      FormaPago: '2',
    });
  });

  it('deja fuera los campos opcionales vacíos', () => {
    const compra = leerCompraDelFormulario(
      formulario({ ...anotada, FechaPago: '', ITBISRetenido: '' })
    );
    expect(Object.keys(compra)).not.toContain('FechaPago');
    expect(Object.keys(compra)).not.toContain('ITBISRetenido');
    expect(Object.keys(compra)).not.toContain('NCFModificado');
  });

  it('pide la fecha del comprobante', () => {
    expect(() => leerCompraDelFormulario(formulario({ ...anotada, FechaComprobante: '' }))).toThrow(
      /Falta la fecha del comprobante/
    );
  });

  it('rechaza una fecha que no viene del campo de fecha', () => {
    expect(() =>
      leerCompraDelFormulario(formulario({ ...anotada, FechaPago: '20/09/2026' }))
    ).toThrow(/Fecha de pago inválida/);
  });
});

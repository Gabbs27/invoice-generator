import { describe, it, expect } from 'vitest';
import { leerSolicitud } from './formulario';

function formulario(campos: Record<string, string | string[]>): FormData {
  const datos = new FormData();
  for (const [campo, valor] of Object.entries(campos)) {
    for (const uno of [valor].flat()) datos.append(campo, uno);
  }
  return datos;
}

const completo: Record<string, string | string[]> = {
  tipo: '31',
  TipoIngresos: '01',
  TipoPago: '1',
  IndicadorMontoGravado: '1',
  RNCComprador: '987654321',
  RazonSocialComprador: 'Cliente Ejemplo SA',
  NombreItem: ['Resma de papel', 'Instalación'],
  IndicadorBienoServicio: ['1', '2'],
  CantidadItem: ['2', '1.5'],
  PrecioUnitarioItem: ['250.00', '1180'],
  IndicadorFacturacion: ['1', '4'],
  DescuentoMonto: ['10.00', ''],
};

describe('formulario de emisión', () => {
  it('traduce el formulario a una solicitud de emisión', () => {
    expect(leerSolicitud(formulario(completo))).toEqual({
      tipo: '31',
      TipoIngresos: '01',
      TipoPago: 1,
      IndicadorMontoGravado: 1,
      Comprador: { RNCComprador: '987654321', RazonSocialComprador: 'Cliente Ejemplo SA' },
      Items: [
        {
          NombreItem: 'Resma de papel',
          IndicadorBienoServicio: 1,
          CantidadItem: '2',
          PrecioUnitarioItem: '250.00',
          IndicadorFacturacion: 1,
          DescuentoMonto: '10.00',
        },
        {
          NombreItem: 'Instalación',
          IndicadorBienoServicio: 2,
          CantidadItem: '1.5',
          PrecioUnitarioItem: '1180',
          IndicadorFacturacion: 4,
        },
      ],
    });
  });

  // Un DescuentoMonto vacío llegaría al XML como <DescuentoMonto></DescuentoMonto>.
  it('no manda un descuento que se dejó vacío', () => {
    expect(leerSolicitud(formulario(completo)).Items[1].DescuentoMonto).toBeUndefined();
  });

  it('quita los espacios de los extremos, y los guiones del RNC', () => {
    const solicitud = leerSolicitud(
      formulario({ ...completo, RNCComprador: ' 9-87-65432-1 ', NombreItem: [' Resma ', 'Otro'] })
    );
    expect(solicitud.Comprador?.RNCComprador).toBe('987654321');
    expect(solicitud.Items[0].NombreItem).toBe('Resma');
  });

  it('sin datos del comprador no manda Comprador', () => {
    const solicitud = leerSolicitud(
      formulario({ ...completo, tipo: '32', RNCComprador: '', RazonSocialComprador: '' })
    );
    expect(solicitud.Comprador).toBeUndefined();
  });

  // Descartarlo emitiría sin comprador una factura que lo quería.
  it('con un solo dato del comprador lo manda igual, para que el motor diga qué falta', () => {
    const solicitud = leerSolicitud(formulario({ ...completo, RNCComprador: '' }));
    expect(solicitud.Comprador).toEqual({
      RNCComprador: '',
      RazonSocialComprador: 'Cliente Ejemplo SA',
    });
  });

  it.each([
    ['tipo', '34'],
    ['TipoIngresos', '07'],
    ['TipoPago', '4'],
    ['IndicadorMontoGravado', '2'],
    ['IndicadorBienoServicio', '3'],
    ['IndicadorFacturacion', '0'],
  ])('rechaza %s = %s, que no está entre sus códigos', (campo, valor) => {
    const datos = formulario({
      ...completo,
      [campo]: Array.isArray(completo[campo]) ? [valor, valor] : valor,
    });
    expect(() => leerSolicitud(datos)).toThrow(`${campo} inválido: ${valor}.`);
  });

  it('rechaza un formulario al que le falta un código', () => {
    const { TipoIngresos, ...sinTipoIngresos } = completo;
    expect(TipoIngresos).toBe('01');
    expect(() => leerSolicitud(formulario(sinTipoIngresos))).toThrow('TipoIngresos inválido: .');
  });

  it('rechaza ítems cuyas columnas no tienen el mismo largo', () => {
    expect(() => leerSolicitud(formulario({ ...completo, CantidadItem: ['2'] }))).toThrow(
      /ítems llegaron incompletos/
    );
  });

  // El campo de fecha del navegador manda AAAA-MM-DD; el Formato e-CF la pide dd-MM-AAAA.
  it('pasa la fecha límite de pago al formato del Formato e-CF', () => {
    const solicitud = leerSolicitud(
      formulario({ ...completo, TipoPago: '2', FechaLimitePago: '2026-09-30' })
    );
    expect(solicitud).toMatchObject({ TipoPago: 2, FechaLimitePago: '30-09-2026' });
  });

  it('sin fecha límite de pago no manda FechaLimitePago', () => {
    const solicitud = leerSolicitud(formulario({ ...completo, FechaLimitePago: '' }));
    expect(solicitud.FechaLimitePago).toBeUndefined();
  });

  it('rechaza una fecha límite de pago que no viene como AAAA-MM-DD', () => {
    expect(() =>
      leerSolicitud(formulario({ ...completo, TipoPago: '2', FechaLimitePago: '30/09/2026' }))
    ).toThrow('FechaLimitePago inválida: 30/09/2026.');
  });
});

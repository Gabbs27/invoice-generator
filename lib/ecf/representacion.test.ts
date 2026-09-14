import { describe, it, expect } from 'vitest';
import { crearCredencialDeDemostracion } from '../credencial';
import { firmarECF } from './firma';
import {
  codigoDeSeguridad,
  leerComprobanteFirmado,
  urlDeConsulta,
  type DatosDeRepresentacion,
} from './representacion';
import { construirXML, type Comprobante } from './xml';

// Informe Técnico e-CF v1.0, sección 18.2.3 (págs. 35–36): lo que lleva el código QR de la
// representación impresa y la URL de consulta de cada caso.

const credencial = crearCredencialDeDemostracion();

const creditoFiscal: Comprobante = {
  eNCF: 'E310000000001',
  FechaVencimientoSecuencia: '31-12-2027',
  IndicadorMontoGravado: 0,
  TipoIngresos: '01',
  TipoPago: 1,
  Emisor: {
    RNCEmisor: '123456789',
    RazonSocialEmisor: 'Comercial Ejemplo SRL',
    DireccionEmisor: 'Calle Primera 1, Santo Domingo',
    FechaEmision: '12-09-2026',
  },
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
      NombreItem: 'Libro',
      IndicadorBienoServicio: 1,
      CantidadItem: '1',
      PrecioUnitarioItem: '700.00',
      IndicadorFacturacion: 4,
    },
  ],
  FechaHoraFirma: '12-09-2026 10:30:00',
};

const firmado = firmarECF(construirXML(creditoFiscal), credencial);

const datos = (cambios: Partial<DatosDeRepresentacion> = {}): DatosDeRepresentacion => ({
  ...leerComprobanteFirmado(firmado),
  ...cambios,
});

describe('representación impresa', () => {
  it('lee del e-CF firmado lo que va impreso', () => {
    const leido = leerComprobanteFirmado(firmado);
    expect(leido).toMatchObject({
      TipoeCF: '31',
      eNCF: 'E310000000001',
      FechaVencimientoSecuencia: '31-12-2027',
      Emisor: {
        RNCEmisor: '123456789',
        RazonSocialEmisor: 'Comercial Ejemplo SRL',
        DireccionEmisor: 'Calle Primera 1, Santo Domingo',
        FechaEmision: '12-09-2026',
      },
      Comprador: { RNCComprador: '987654321', RazonSocialComprador: 'Cliente Ejemplo SA' },
      Items: [
        {
          NumeroLinea: '1',
          IndicadorFacturacion: '1',
          NombreItem: 'Resma de papel',
          CantidadItem: '2',
          PrecioUnitarioItem: '250.00',
          DescuentoMonto: '10.00',
          MontoItem: '490.00',
        },
        {
          NumeroLinea: '2',
          IndicadorFacturacion: '4',
          NombreItem: 'Libro',
          CantidadItem: '1',
          PrecioUnitarioItem: '700.00',
          MontoItem: '700.00',
        },
      ],
      Totales: {
        MontoGravadoTotal: '490.00',
        MontoExento: '700.00',
        TotalITBIS: '88.20',
        MontoTotal: '1278.20',
      },
      FechaHoraFirma: '12-09-2026 10:30:00',
    });
    expect(firmado).toContain(`<SignatureValue>${leido.SignatureValue}</SignatureValue>`);
  });

  it('una factura de consumo sin comprador no lleva Comprador', () => {
    const consumo = firmarECF(
      construirXML({
        ...creditoFiscal,
        eNCF: 'E320000000001',
        FechaVencimientoSecuencia: undefined,
        Comprador: undefined,
      }),
      credencial
    );
    expect(leerComprobanteFirmado(consumo).Comprador).toBeUndefined();
  });

  it('devuelve los nombres sin el escape de XML', () => {
    const escapado = firmarECF(
      construirXML({
        ...creditoFiscal,
        Emisor: { ...creditoFiscal.Emisor, RazonSocialEmisor: 'Pérez & Hijos <SRL>' },
      }),
      credencial
    );
    expect(leerComprobanteFirmado(escapado).Emisor.RazonSocialEmisor).toBe('Pérez & Hijos <SRL>');
  });

  it('no lee un e-CF sin firma', () => {
    expect(() => leerComprobanteFirmado(construirXML(creditoFiscal))).toThrow(/firma/);
  });

  // Los modelos de las págs. 38–40 imprimen códigos como "RslYCb" y "C78q+V": caracteres
  // del SignatureValue, que va en base64.
  it('el código de seguridad son los primeros seis caracteres del SignatureValue', () => {
    expect(codigoDeSeguridad('C78q+VxYz0123456789==')).toBe('C78q+V');
  });

  it('no saca un código de seguridad de un SignatureValue de menos de seis caracteres', () => {
    expect(() => codigoDeSeguridad('C78q+')).toThrow(/seis caracteres/);
  });

  it('arma la consulta de un e-CF con sus siete parámetros, en el orden del ejemplo de DGII', () => {
    expect(urlDeConsulta(datos({ SignatureValue: 'RslYCbAbCdEf==' }))).toBe(
      'https://ecf.dgii.gov.do/ecf/ConsultaTimbre?RncEmisor=123456789&RncComprador=987654321' +
        '&ENCF=E310000000001&FechaEmision=12-09-2026&MontoTotal=1278.20' +
        '&FechaFirma=12-09-2026%2010:30:00&CodigoSeguridad=RslYCb'
    );
  });

  it('codifica los caracteres del código de seguridad que romperían la URL', () => {
    expect(urlDeConsulta(datos({ SignatureValue: 'C7/q+VAbCdEf==' }))).toMatch(
      /&CodigoSeguridad=C7%2Fq%2BV$/
    );
  });

  it('una factura de consumo menor a RD$250,000.00 se consulta con cuatro parámetros', () => {
    const consumo = datos({
      TipoeCF: '32',
      eNCF: 'E320000000001',
      Comprador: undefined,
      Totales: { MontoTotal: '249999.99' },
      SignatureValue: 'RslYCbAbCdEf==',
    });
    expect(urlDeConsulta(consumo)).toBe(
      'https://fc.dgii.gov.do/eCF/ConsultaTimbreFC?RncEmisor=123456789&ENCF=E320000000001' +
        '&MontoTotal=249999.99&CodigoSeguridad=RslYCb'
    );
  });

  it('desde RD$250,000.00 la factura de consumo se consulta como cualquier e-CF', () => {
    const consumo = datos({
      TipoeCF: '32',
      eNCF: 'E320000000001',
      Totales: { MontoTotal: '250000.00' },
      SignatureValue: 'RslYCbAbCdEf==',
    });
    expect(urlDeConsulta(consumo)).toMatch(
      /^https:\/\/ecf\.dgii\.gov\.do\/ecf\/ConsultaTimbre\?RncEmisor=123456789&RncComprador=987654321&ENCF=E320000000001&/
    );
  });

  it('no arma la consulta con un MontoTotal que no trae dos decimales', () => {
    expect(() => urlDeConsulta(datos({ Totales: { MontoTotal: '1278.2' } }))).toThrow(
      /MontoTotal inválido/
    );
  });

  it('no arma la consulta completa sin RncComprador', () => {
    expect(() => urlDeConsulta(datos({ Comprador: undefined }))).toThrow(/RncComprador/);
  });
});

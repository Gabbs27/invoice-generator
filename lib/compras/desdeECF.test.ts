import { describe, it, expect } from 'vitest';
import { crearCredencialDeDemostracion } from '../credencial';
import { validarContraXSD } from '../ecf/validar';
import { emitirECF, type SolicitudDeEmision } from '../emitir';
import { leerEsquema } from '../esquemas';
import { emisorDePrueba } from '../storage/contrato';
import { AlmacenamientoEnMemoria } from '../storage/memoria';
import { importarECF, type DependenciasDeImportacion } from './desdeECF';

// El negocio que compra. El proveedor es emisorDePrueba, con RNC 123456789.
const NEGOCIO = '101010101';
const credencial = crearCredencialDeDemostracion();

const conXSD: DependenciasDeImportacion = {
  rncDelNegocio: NEGOCIO,
  validar: (xml, tipo) => validarContraXSD(xml, leerEsquema(tipo)),
};

// Para los casos que el emisor de este proyecto no arma (tabla de pagos, impuestos adicionales,
// retenciones, notas): se edita el XML, y la firma deja de valer, así que se salta el XSD.
const sinXSD: DependenciasDeImportacion = {
  rncDelNegocio: NEGOCIO,
  validar: async () => ({ valido: true, errores: [] }),
};

const factura: SolicitudDeEmision = {
  tipo: '31',
  IndicadorMontoGravado: 0,
  TipoIngresos: '01',
  TipoPago: 1,
  Comprador: { RNCComprador: NEGOCIO, RazonSocialComprador: 'Nuestro Negocio SRL' },
  Items: [
    {
      NombreItem: 'Resma de papel',
      IndicadorBienoServicio: 1,
      CantidadItem: '2',
      PrecioUnitarioItem: '250.00',
      IndicadorFacturacion: 1,
    },
  ],
};

async function ecf(cambios: Partial<SolicitudDeEmision> = {}): Promise<string> {
  const resultado = await emitirECF(
    { ...factura, ...cambios },
    {
      almacenamiento: new AlmacenamientoEnMemoria(emisorDePrueba()),
      credencial: () => credencial,
      leerEsquema,
      ahora: () => new Date('2026-09-12T14:30:00Z'),
    }
  );
  if (!resultado.emitido) throw new Error(resultado.errores.join(' '));
  return resultado.xml;
}

describe('importar un e-CF recibido', () => {
  it('llena la compra con lo que dice un e-CF 31 válido', async () => {
    expect(await importarECF(await ecf(), conXSD)).toEqual({
      importado: true,
      borrador: {
        RNCCedula: '123456789',
        NCF: 'E310000000001',
        FechaComprobante: '20260912',
        MontoServicios: '0.00',
        MontoBienes: '500.00',
        ITBISFacturado: '90.00',
      },
      porCompletar: ['TipoBienesServicios', 'FormaPago'],
    });
  });

  // Con los precios con ITBIS, el monto sin impuestos sale de MontoGravadoTotal.
  it('reparte el monto sin impuestos entre bienes y servicios', async () => {
    const xml = await ecf({
      IndicadorMontoGravado: 1,
      Items: [
        {
          NombreItem: 'Resma de papel',
          IndicadorBienoServicio: 1,
          CantidadItem: '1',
          PrecioUnitarioItem: '354.00',
          IndicadorFacturacion: 1,
        },
        {
          NombreItem: 'Instalación',
          IndicadorBienoServicio: 2,
          CantidadItem: '1',
          PrecioUnitarioItem: '236.00',
          IndicadorFacturacion: 1,
        },
      ],
    });
    expect(await importarECF(xml, conXSD)).toMatchObject({
      importado: true,
      borrador: { MontoBienes: '300.00', MontoServicios: '200.00', ITBISFacturado: '90.00' },
    });
  });

  it('una venta a crédito sin tabla de pagos es una compra a crédito', async () => {
    const xml = await ecf({ TipoPago: 2, FechaLimitePago: '30-09-2026' });
    expect(await importarECF(xml, conXSD)).toMatchObject({
      importado: true,
      borrador: { FormaPago: '4' },
      porCompletar: ['TipoBienesServicios'],
    });
  });

  it('traduce una sola forma de pago y marca como mixtas varias', async () => {
    const forma = (codigo: string, monto: string) =>
      `<FormaDePago><FormaPago>${codigo}</FormaPago><MontoPago>${monto}</MontoPago></FormaDePago>`;
    const base = await ecf();
    const permuta = base.replace(
      '</TipoPago>',
      `</TipoPago><TablaFormasPago>${forma('6', '590.00')}</TablaFormasPago>`
    );
    const mixta = base.replace(
      '</TipoPago>',
      `</TipoPago><TablaFormasPago>${forma('1', '300.00')}${forma('3', '290.00')}</TablaFormasPago>`
    );
    expect(await importarECF(permuta, sinXSD)).toMatchObject({ borrador: { FormaPago: '5' } });
    expect(await importarECF(mixta, sinXSD)).toMatchObject({ borrador: { FormaPago: '7' } });
  });

  // Formato e-CF, Tabla I: 001 propina legal; 002 y 005 otros; 003, 004 y del 006 al 039, selectivo.
  it('reparte los impuestos adicionales en propina, otros impuestos y selectivo', async () => {
    const impuesto = (tipo: string, monto: string) =>
      `<ImpuestoAdicional><TipoImpuesto>${tipo}</TipoImpuesto><TasaImpuestoAdicional>10</TasaImpuestoAdicional>${monto}</ImpuestoAdicional>`;
    const xml = (await ecf()).replace(
      '<MontoTotal>',
      '<ImpuestosAdicionales>' +
        impuesto('001', '<OtrosImpuestosAdicionales>50.00</OtrosImpuestosAdicionales>') +
        impuesto('002', '<OtrosImpuestosAdicionales>5.00</OtrosImpuestosAdicionales>') +
        impuesto(
          '006',
          '<MontoImpuestoSelectivoConsumoEspecifico>20.00</MontoImpuestoSelectivoConsumoEspecifico>'
        ) +
        '</ImpuestosAdicionales><MontoTotal>'
    );
    expect(await importarECF(xml, sinXSD)).toMatchObject({
      borrador: { PropinaLegal: '50.00', OtrosImpuestos: '5.00', ImpuestoSelectivo: '20.00' },
    });
  });

  it('trae las retenciones y pide la fecha de pago y el tipo de retención', async () => {
    const xml = (await ecf()).replace(
      '</MontoTotal>',
      '</MontoTotal><TotalITBISRetenido>27.00</TotalITBISRetenido><TotalISRRetencion>50.00</TotalISRRetencion>'
    );
    expect(await importarECF(xml, sinXSD)).toMatchObject({
      borrador: { ITBISRetenido: '27.00', MontoRetencionRenta: '50.00' },
      porCompletar: ['TipoBienesServicios', 'FormaPago', 'FechaPago', 'TipoRetencionISR'],
    });
  });

  it('importa una nota de crédito con el NCF que modifica', async () => {
    const xml = (await ecf())
      .replace(
        '<TipoeCF>31</TipoeCF><eNCF>E310000000001</eNCF>',
        '<TipoeCF>34</TipoeCF><eNCF>E340000000001</eNCF>'
      )
      .replace(/<FechaVencimientoSecuencia>[^<]*<\/FechaVencimientoSecuencia>/, '')
      .replace(
        '<FechaHoraFirma>',
        '<InformacionReferencia><NCFModificado>E310000000009</NCFModificado><FechaNCFModificado>01-09-2026</FechaNCFModificado><CodigoModificacion>3</CodigoModificacion></InformacionReferencia><FechaHoraFirma>'
      );
    expect(await importarECF(xml, sinXSD)).toMatchObject({
      importado: true,
      borrador: { NCF: 'E340000000001', NCFModificado: 'E310000000009' },
    });
  });

  it('rechaza una factura de consumo', async () => {
    expect(await importarECF(await ecf({ tipo: '32', Comprador: undefined }), conXSD)).toEqual({
      importado: false,
      errores: [expect.stringMatching(/factura de consumo/)],
    });
  });

  it('rechaza un e-CF que es para otro RNC', async () => {
    const xml = await ecf({
      Comprador: { RNCComprador: '222222222', RazonSocialComprador: 'Otro Negocio SRL' },
    });
    expect(await importarECF(xml, conXSD)).toEqual({
      importado: false,
      errores: [expect.stringMatching(/es para el RNC 222222222/)],
    });
  });

  it('rechaza un XML que no valida contra el XSD de su tipo', async () => {
    const xml = (await ecf()).replace('<TipoIngresos>01</TipoIngresos>', '');
    expect(await importarECF(xml, conXSD)).toMatchObject({
      importado: false,
      errores: [expect.stringMatching(/no valida contra el XSD/), expect.any(String)],
    });
  });

  it('rechaza los tipos que no se importan', async () => {
    const xml = (await ecf()).replace('<TipoeCF>31</TipoeCF>', '<TipoeCF>41</TipoeCF>');
    expect(await importarECF(xml, sinXSD)).toEqual({
      importado: false,
      errores: [expect.stringMatching(/31, 33 y 34/)],
    });
  });

  it('rechaza lo que no es un e-CF', async () => {
    expect(await importarECF('<Factura/>', sinXSD)).toEqual({
      importado: false,
      errores: [expect.stringMatching(/no es un e-CF/)],
    });
    expect(await importarECF('hola', sinXSD)).toMatchObject({ importado: false });
  });
});

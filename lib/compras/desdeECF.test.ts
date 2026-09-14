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

// Cada caso valida contra el XSD de su tipo. Lo que el emisor de este proyecto no arma (tabla de
// pagos, impuestos adicionales, retenciones, descuentos globales, notas) sale de editar un e-CF
// emitido: la firma deja de valer, pero el XSD no revisa firmas.
const conXSD: DependenciasDeImportacion = {
  rncDelNegocio: NEGOCIO,
  validar: (xml, tipo) => validarContraXSD(xml, leerEsquema(tipo)),
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

// Cambia una parte del XML y falla si no la encuentra: un caso no pasa sin editar nada.
function cambiar(xml: string, buscado: string | RegExp, nuevo: string): string {
  const cambiado = xml.replace(buscado, nuevo);
  if (cambiado === xml) throw new Error(`No está ${String(buscado)} en el e-CF.`);
  return cambiado;
}

// Un bien gravado al 18 % y un servicio exento.
const bienGravadoYServicioExento = (
  bien: string,
  servicio: string
): SolicitudDeEmision['Items'] => [
  {
    NombreItem: 'Resma de papel',
    IndicadorBienoServicio: 1,
    CantidadItem: '1',
    PrecioUnitarioItem: bien,
    IndicadorFacturacion: 1,
  },
  {
    NombreItem: 'Asesoría',
    IndicadorBienoServicio: 2,
    CantidadItem: '1',
    PrecioUnitarioItem: servicio,
    IndicadorFacturacion: 4,
  },
];

const REFERENCIA =
  '<InformacionReferencia><NCFModificado>E310000000009</NCFModificado>' +
  '<FechaNCFModificado>01-09-2026</FechaNCFModificado><CodigoModificacion>3</CodigoModificacion>' +
  '</InformacionReferencia>';

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

  // Con precios con ITBIS, cada MontoItem trae el impuesto de su tasa: se reparte la base de cada
  // tasa (MontoGravadoI1 a I3 y MontoExento) entre los ítems de esa tasa.
  it('reparte por tasa cuando los precios traen ITBIS', async () => {
    const xml = await ecf({
      IndicadorMontoGravado: 1,
      Items: bienGravadoYServicioExento('118.00', '100.00'),
    });
    expect(await importarECF(xml, conXSD)).toMatchObject({
      importado: true,
      borrador: { MontoBienes: '100.00', MontoServicios: '100.00', ITBISFacturado: '18.00' },
    });
  });

  // Un descuento global de 50.00 sobre lo gravado al 18 %: baja MontoGravadoI1 y no toca lo exento.
  it('aplica un descuento global solo a la tasa que descuenta', async () => {
    const totales = [
      ['MontoGravadoTotal', '250.00'],
      ['MontoGravadoI1', '250.00'],
      ['TotalITBIS', '45.00'],
      ['TotalITBIS1', '45.00'],
      ['MontoTotal', '495.00'],
    ] as const;
    let xml = await ecf({ Items: bienGravadoYServicioExento('300.00', '200.00') });
    for (const [elemento, valor] of totales) {
      const etiqueta = new RegExp(`<${elemento}>[^<]*</${elemento}>`);
      xml = cambiar(xml, etiqueta, `<${elemento}>${valor}</${elemento}>`);
    }
    const descuento =
      '<DescuentosORecargos><DescuentoORecargo><NumeroLinea>1</NumeroLinea>' +
      '<TipoAjuste>D</TipoAjuste>' +
      '<DescripcionDescuentooRecargo>Descuento por volumen</DescripcionDescuentooRecargo>' +
      '<TipoValor>$</TipoValor><MontoDescuentooRecargo>50.00</MontoDescuentooRecargo>' +
      '<IndicadorFacturacionDescuentooRecargo>1</IndicadorFacturacionDescuentooRecargo>' +
      '</DescuentoORecargo></DescuentosORecargos>';
    xml = cambiar(xml, '</DetallesItems>', `</DetallesItems>${descuento}`);
    expect(await importarECF(xml, conXSD)).toMatchObject({
      importado: true,
      borrador: { MontoBienes: '250.00', MontoServicios: '200.00', ITBISFacturado: '45.00' },
    });
  });

  // Los indicadores son enteros en el XSD, que acepta 01 y 02: se comparan como números.
  it('lee los indicadores escritos con ceros a la izquierda', async () => {
    let xml = await ecf({
      Items: [
        {
          NombreItem: 'Instalación',
          IndicadorBienoServicio: 2,
          CantidadItem: '1',
          PrecioUnitarioItem: '100.00',
          IndicadorFacturacion: 1,
        },
      ],
    });
    xml = cambiar(
      xml,
      '<IndicadorFacturacion>1</IndicadorFacturacion>',
      '<IndicadorFacturacion>01</IndicadorFacturacion>'
    );
    xml = cambiar(
      xml,
      '<IndicadorBienoServicio>2</IndicadorBienoServicio>',
      '<IndicadorBienoServicio>02</IndicadorBienoServicio>'
    );
    expect(await importarECF(xml, conXSD)).toMatchObject({
      importado: true,
      borrador: { MontoServicios: '100.00', MontoBienes: '0.00', ITBISFacturado: '18.00' },
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
    const permuta = cambiar(
      base,
      '</TipoPago>',
      `</TipoPago><TablaFormasPago>${forma('6', '590.00')}</TablaFormasPago>`
    );
    const mixta = cambiar(
      base,
      '</TipoPago>',
      `</TipoPago><TablaFormasPago>${forma('1', '300.00')}${forma('3', '290.00')}</TablaFormasPago>`
    );
    expect(await importarECF(permuta, conXSD)).toMatchObject({ borrador: { FormaPago: '5' } });
    expect(await importarECF(mixta, conXSD)).toMatchObject({ borrador: { FormaPago: '7' } });
  });

  // Formato e-CF, Tabla I: 001 propina legal; 002 y 005 otros; 003, 004 y del 006 al 039, selectivo.
  it('reparte los impuestos adicionales en propina, otros impuestos y selectivo', async () => {
    const impuesto = (tipo: string, monto: string) =>
      `<ImpuestoAdicional><TipoImpuesto>${tipo}</TipoImpuesto><TasaImpuestoAdicional>10</TasaImpuestoAdicional>${monto}</ImpuestoAdicional>`;
    const xml = cambiar(
      await ecf(),
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
    expect(await importarECF(xml, conXSD)).toMatchObject({
      borrador: { PropinaLegal: '50.00', OtrosImpuestos: '5.00', ImpuestoSelectivo: '20.00' },
    });
  });

  it('trae las retenciones y pide la fecha de pago y el tipo de retención', async () => {
    const xml = cambiar(
      await ecf(),
      '</MontoTotal>',
      '</MontoTotal><TotalITBISRetenido>27.00</TotalITBISRetenido><TotalISRRetencion>50.00</TotalISRRetencion>'
    );
    expect(await importarECF(xml, conXSD)).toMatchObject({
      borrador: { ITBISRetenido: '27.00', MontoRetencionRenta: '50.00' },
      porCompletar: ['TipoBienesServicios', 'FormaPago', 'FechaPago', 'TipoRetencionISR'],
    });
  });

  it('importa una nota de débito con el NCF que modifica', async () => {
    let xml = cambiar(
      await ecf(),
      '<TipoeCF>31</TipoeCF><eNCF>E310000000001</eNCF>',
      '<TipoeCF>33</TipoeCF><eNCF>E330000000001</eNCF>'
    );
    xml = cambiar(xml, '<FechaHoraFirma>', `${REFERENCIA}<FechaHoraFirma>`);
    expect(await importarECF(xml, conXSD)).toMatchObject({
      importado: true,
      borrador: { NCF: 'E330000000001', NCFModificado: 'E310000000009', MontoBienes: '500.00' },
    });
  });

  it('importa una nota de crédito con el NCF que modifica', async () => {
    let xml = cambiar(
      await ecf(),
      '<TipoeCF>31</TipoeCF><eNCF>E310000000001</eNCF>',
      '<TipoeCF>34</TipoeCF><eNCF>E340000000001</eNCF>'
    );
    // El 34 no lleva FechaVencimientoSecuencia y sí IndicadorNotaCredito.
    xml = cambiar(
      xml,
      /<FechaVencimientoSecuencia>[^<]*<\/FechaVencimientoSecuencia>/,
      '<IndicadorNotaCredito>0</IndicadorNotaCredito>'
    );
    xml = cambiar(xml, '<FechaHoraFirma>', `${REFERENCIA}<FechaHoraFirma>`);
    expect(await importarECF(xml, conXSD)).toMatchObject({
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
    const xml = cambiar(await ecf(), '<TipoIngresos>01</TipoIngresos>', '');
    expect(await importarECF(xml, conXSD)).toMatchObject({
      importado: false,
      errores: [expect.stringMatching(/no valida contra el XSD/), expect.any(String)],
    });
  });

  it('rechaza los tipos que no se importan', async () => {
    const xml = cambiar(await ecf(), '<TipoeCF>31</TipoeCF>', '<TipoeCF>41</TipoeCF>');
    expect(await importarECF(xml, conXSD)).toEqual({
      importado: false,
      errores: [expect.stringMatching(/31, 33 y 34/)],
    });
  });

  it('rechaza lo que no es un e-CF', async () => {
    expect(await importarECF('<Factura/>', conXSD)).toEqual({
      importado: false,
      errores: [expect.stringMatching(/no es un e-CF/)],
    });
    expect(await importarECF('hola', conXSD)).toMatchObject({ importado: false });
  });
});

import { describe, it, expect } from 'vitest';
import { construirXML, type Comprobante, type ItemComprobante } from './xml';

// Nombres y orden de los elementos: esquemas/e-CF 31 v.1.0.xsd y e-CF 32 v.1.0.xsd.
// Condiciones: el Formato e-CF v1.0, páginas impresas.

const emisor = {
  RNCEmisor: '123456789',
  RazonSocialEmisor: 'Comercial Ejemplo SRL',
  DireccionEmisor: 'Calle Primera 1, Santo Domingo',
  FechaEmision: '12-09-2026',
};

const comprador = { RNCComprador: '987654321', RazonSocialComprador: 'Cliente Ejemplo SA' };

const itemBase: ItemComprobante = {
  NombreItem: 'Resma de papel',
  IndicadorBienoServicio: 1,
  CantidadItem: '2',
  PrecioUnitarioItem: '250.00',
  IndicadorFacturacion: 1,
};

const facturaCredito = (cambios: Partial<Comprobante> = {}): Comprobante => ({
  eNCF: 'E310000000001',
  FechaVencimientoSecuencia: '31-12-2027',
  IndicadorMontoGravado: 0,
  TipoIngresos: '01',
  TipoPago: 1,
  Emisor: emisor,
  Comprador: comprador,
  Items: [itemBase],
  FechaHoraFirma: '12-09-2026 10:30:00',
  ...cambios,
});

const facturaConsumo = (cambios: Partial<Comprobante> = {}): Comprobante => ({
  eNCF: 'E320000000001',
  IndicadorMontoGravado: 1,
  TipoIngresos: '01',
  TipoPago: 1,
  Emisor: emisor,
  Items: [{ ...itemBase, NombreItem: 'Café', CantidadItem: '1', PrecioUnitarioItem: '118.00' }],
  FechaHoraFirma: '12-09-2026 10:30:00',
  ...cambios,
});

describe('XML del e-CF', () => {
  it('arma una factura de crédito fiscal en el orden del XSD', () => {
    expect(construirXML(facturaCredito())).toBe(
      '<?xml version="1.0" encoding="utf-8"?>' +
        '<ECF>' +
        '<Encabezado>' +
        '<Version>1.0</Version>' +
        '<IdDoc>' +
        '<TipoeCF>31</TipoeCF>' +
        '<eNCF>E310000000001</eNCF>' +
        '<FechaVencimientoSecuencia>31-12-2027</FechaVencimientoSecuencia>' +
        '<IndicadorMontoGravado>0</IndicadorMontoGravado>' +
        '<TipoIngresos>01</TipoIngresos>' +
        '<TipoPago>1</TipoPago>' +
        '</IdDoc>' +
        '<Emisor>' +
        '<RNCEmisor>123456789</RNCEmisor>' +
        '<RazonSocialEmisor>Comercial Ejemplo SRL</RazonSocialEmisor>' +
        '<DireccionEmisor>Calle Primera 1, Santo Domingo</DireccionEmisor>' +
        '<FechaEmision>12-09-2026</FechaEmision>' +
        '</Emisor>' +
        '<Comprador>' +
        '<RNCComprador>987654321</RNCComprador>' +
        '<RazonSocialComprador>Cliente Ejemplo SA</RazonSocialComprador>' +
        '</Comprador>' +
        '<Totales>' +
        '<MontoGravadoTotal>500.00</MontoGravadoTotal>' +
        '<MontoGravadoI1>500.00</MontoGravadoI1>' +
        '<ITBIS1>18</ITBIS1>' +
        '<TotalITBIS>90.00</TotalITBIS>' +
        '<TotalITBIS1>90.00</TotalITBIS1>' +
        '<MontoTotal>590.00</MontoTotal>' +
        '</Totales>' +
        '</Encabezado>' +
        '<DetallesItems>' +
        '<Item>' +
        '<NumeroLinea>1</NumeroLinea>' +
        '<IndicadorFacturacion>1</IndicadorFacturacion>' +
        '<NombreItem>Resma de papel</NombreItem>' +
        '<IndicadorBienoServicio>1</IndicadorBienoServicio>' +
        '<CantidadItem>2</CantidadItem>' +
        '<PrecioUnitarioItem>250.00</PrecioUnitarioItem>' +
        '<MontoItem>500.00</MontoItem>' +
        '</Item>' +
        '</DetallesItems>' +
        '<FechaHoraFirma>12-09-2026 10:30:00</FechaHoraFirma>' +
        '</ECF>'
    );
  });

  // XSD del 32: no hay FechaVencimientoSecuencia, y Comprador va aunque esté vacío.
  it('arma una factura de consumo sin comprador ni vencimiento de secuencia', () => {
    const xml = construirXML(facturaConsumo());
    expect(xml).toContain(
      '<IdDoc><TipoeCF>32</TipoeCF><eNCF>E320000000001</eNCF>' +
        '<IndicadorMontoGravado>1</IndicadorMontoGravado>' +
        '<TipoIngresos>01</TipoIngresos><TipoPago>1</TipoPago></IdDoc>'
    );
    expect(xml).toContain('</Emisor><Comprador></Comprador><Totales>');
    expect(xml).toContain('<MontoGravadoI1>100.00</MontoGravadoI1>');
    expect(xml).toContain('<MontoTotal>118.00</MontoTotal>');
  });

  // Formato, págs. 12–13: en el tipo 32 desde DOP$250,000.00 hay que identificar al comprador.
  it('exige el comprador en una factura de consumo desde RD$250,000.00', () => {
    const exento = (PrecioUnitarioItem: string): ItemComprobante[] => [
      { ...itemBase, CantidadItem: '1', PrecioUnitarioItem, IndicadorFacturacion: 4 },
    ];
    expect(() => construirXML(facturaConsumo({ Items: exento('249999.99') }))).not.toThrow();
    expect(() => construirXML(facturaConsumo({ Items: exento('250000.00') }))).toThrow(
      /comprador/i
    );
    expect(() =>
      construirXML(facturaConsumo({ Items: exento('250000.00'), Comprador: comprador }))
    ).not.toThrow();
  });

  it('lleva el descuento y el recargo del ítem con sus tablas', () => {
    const xml = construirXML(
      facturaCredito({ Items: [{ ...itemBase, DescuentoMonto: '50.00', RecargoMonto: '10.00' }] })
    );
    expect(xml).toContain(
      '<PrecioUnitarioItem>250.00</PrecioUnitarioItem>' +
        '<DescuentoMonto>50.00</DescuentoMonto>' +
        '<TablaSubDescuento><SubDescuento><TipoSubDescuento>$</TipoSubDescuento>' +
        '<MontoSubDescuento>50.00</MontoSubDescuento></SubDescuento></TablaSubDescuento>' +
        '<RecargoMonto>10.00</RecargoMonto>' +
        '<TablaSubRecargo><SubRecargo><TipoSubRecargo>$</TipoSubRecargo>' +
        '<MontoSubRecargo>10.00</MontoSubRecargo></SubRecargo></TablaSubRecargo>' +
        '<MontoItem>460.00</MontoItem>'
    );
  });

  // Formato, pág. 7: IndicadorMontoGravado es condicional a que haya ítems gravados.
  it('omite IndicadorMontoGravado cuando ningún ítem es gravado', () => {
    const xml = construirXML(facturaCredito({ Items: [{ ...itemBase, IndicadorFacturacion: 4 }] }));
    expect(xml).not.toContain('IndicadorMontoGravado');
  });

  it('numera las líneas desde 1', () => {
    const xml = construirXML(facturaCredito({ Items: [itemBase, itemBase, itemBase] }));
    expect(xml.match(/<NumeroLinea>\d+<\/NumeroLinea>/g)).toEqual([
      '<NumeroLinea>1</NumeroLinea>',
      '<NumeroLinea>2</NumeroLinea>',
      '<NumeroLinea>3</NumeroLinea>',
    ]);
  });

  it('escapa los caracteres especiales de XML', () => {
    const xml = construirXML(
      facturaCredito({ Emisor: { ...emisor, RazonSocialEmisor: 'Pérez & Hijos <SRL>' } })
    );
    expect(xml).toContain('<RazonSocialEmisor>Pérez &amp; Hijos &lt;SRL&gt;</RazonSocialEmisor>');
  });

  it('acepta los largos máximos del XSD', () => {
    const comprobante = facturaCredito({
      Emisor: { ...emisor, RazonSocialEmisor: 'x'.repeat(150), DireccionEmisor: 'x'.repeat(100) },
      Items: Array.from({ length: 1000 }, () => ({ ...itemBase, NombreItem: 'x'.repeat(80) })),
    });
    expect(() => construirXML(comprobante)).not.toThrow();
  });

  // El control negativo: lo que el XSD o el Formato no admiten. Cada caso nombra el
  // error que espera, para que un fallo cualquiera (un TypeError) no pase por rechazo.
  it.each<[string, Partial<Comprobante>, RegExp]>([
    ['un e-NCF inválido', { eNCF: 'E31000000001' }, /e-NCF inválido/],
    ['un tipo que esta versión no arma', { eNCF: 'E330000000001' }, /tipo 33/],
    [
      'una factura de crédito fiscal sin vencimiento de secuencia',
      { FechaVencimientoSecuencia: undefined },
      /FechaVencimientoSecuencia/,
    ],
    ['una factura de crédito fiscal sin comprador', { Comprador: undefined }, /comprador/],
    // Formato e-CF, pág. 9: FechaLimitePago es condicional a que el tipo de pago sea a crédito.
    ['una factura a crédito, que lleva FechaLimitePago', { TipoPago: 2 }, /FechaLimitePago/],
    ['un RNC de emisor mal formado', { Emisor: { ...emisor, RNCEmisor: '12345678' } }, /RNCEmisor/],
    [
      'un RNC de comprador mal formado',
      { Comprador: { ...comprador, RNCComprador: '1-23-45678-9' } },
      /RNCComprador/,
    ],
    [
      'una fecha de emisión sin el formato dd-MM-AAAA',
      { Emisor: { ...emisor, FechaEmision: '2026-09-12' } },
      /FechaEmision/,
    ],
    [
      'una fecha de emisión sin el cero del día',
      { Emisor: { ...emisor, FechaEmision: '1-09-2026' } },
      /FechaEmision/,
    ],
    [
      'una fecha de emisión que no existe',
      { Emisor: { ...emisor, FechaEmision: '31-02-2026' } },
      /FechaEmision/,
    ],
    ['una hora de firma sin segundos', { FechaHoraFirma: '12-09-2026 10:30' }, /FechaHoraFirma/],
    ['una razón social vacía', { Emisor: { ...emisor, RazonSocialEmisor: '' } }, /RazonSocialEmisor/],
    [
      'una razón social de 151 caracteres',
      { Emisor: { ...emisor, RazonSocialEmisor: 'x'.repeat(151) } },
      /RazonSocialEmisor/,
    ],
    [
      'un nombre de ítem de 81 caracteres',
      { Items: [{ ...itemBase, NombreItem: 'x'.repeat(81) }] },
      /NombreItem/,
    ],
    [
      'un carácter de control en un nombre',
      { Items: [{ ...itemBase, NombreItem: 'Papel' }] },
      /NombreItem/,
    ],
    ['más de 1000 ítems', { Items: Array.from({ length: 1001 }, () => itemBase) }, /1000/],
  ])('rechaza %s', (_motivo, cambios, error) => {
    expect(() => construirXML(facturaCredito(cambios))).toThrow(error);
  });

  it('no pone vencimiento de secuencia en una factura de consumo: su XSD no lo tiene', () => {
    expect(() =>
      construirXML(facturaConsumo({ FechaVencimientoSecuencia: '31-12-2027' }))
    ).toThrow(/FechaVencimientoSecuencia/);
  });
});

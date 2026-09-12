import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateXML } from 'xmllint-wasm';
import { completarEsquema, validarContraXSD } from './validar';
import { construirXML, type Comprobante, type ItemComprobante } from './xml';

// El motor no toca el disco: las pruebas leen los XSD del repo y le pasan el texto.
const esquema = (archivo: string) => readFileSync(`esquemas/${archivo}`, 'utf8');
const esquema31 = esquema('e-CF 31 v.1.0.xsd');
const esquema32 = esquema('e-CF 32 v.1.0.xsd');

// Relleno para el xs:any que el XSD reserva a la firma. Sin él, ningún e-CF valida.
const conFirma = (xml: string) =>
  xml.replace('</ECF>', '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"/></ECF>');

const emisor = {
  RNCEmisor: '123456789',
  RazonSocialEmisor: 'Comercial Ejemplo SRL',
  DireccionEmisor: 'Calle Primera 1, Santo Domingo',
  FechaEmision: '12-09-2026',
};

const item: ItemComprobante = {
  NombreItem: 'Resma de papel',
  IndicadorBienoServicio: 1,
  CantidadItem: '2',
  PrecioUnitarioItem: '250.00',
  IndicadorFacturacion: 1,
};

const factura31: Comprobante = {
  eNCF: 'E310000000001',
  FechaVencimientoSecuencia: '31-12-2027',
  IndicadorMontoGravado: 0,
  TipoIngresos: '01',
  TipoPago: 1,
  Emisor: emisor,
  Comprador: { RNCComprador: '987654321', RazonSocialComprador: 'Cliente Ejemplo SA' },
  Items: [item],
  FechaHoraFirma: '12-09-2026 10:30:00',
};

const factura32: Comprobante = {
  eNCF: 'E320000000001',
  IndicadorMontoGravado: 1,
  TipoIngresos: '01',
  TipoPago: 1,
  Emisor: emisor,
  Items: [item],
  FechaHoraFirma: '12-09-2026 10:30:00',
};

const xml31 = conFirma(construirXML(factura31));
const xml32 = conFirma(construirXML(factura32));

describe('validación contra el XSD de DGII', () => {
  it('acepta un e-CF 32 bien formado', async () => {
    expect(await validarContraXSD(xml32, esquema32)).toEqual({ valido: true, errores: [] });
  });

  it('acepta un e-CF 31 bien formado', async () => {
    expect(await validarContraXSD(xml31, esquema31)).toEqual({ valido: true, errores: [] });
  });

  it('rechaza un e-CF al que le falta el e-NCF', async () => {
    const resultado = await validarContraXSD(xml31.replace(/<eNCF>[^<]*<\/eNCF>/, ''), esquema31);
    expect(resultado.valido).toBe(false);
    expect(resultado.errores.join(' ')).toMatch(/eNCF/);
  });

  // Control: el validador tiene que poder distinguir algo.
  it('rechaza XML que no es un e-CF en absoluto', async () => {
    expect((await validarContraXSD('<hola/>', esquema31)).valido).toBe(false);
  });

  it('rechaza XML mal formado', async () => {
    expect((await validarContraXSD('<ECF><sin cerrar>', esquema32)).valido).toBe(false);
  });

  it('rechaza un e-CF sin firmar: el XSD exige la firma', async () => {
    expect((await validarContraXSD(construirXML(factura32), esquema32)).valido).toBe(false);
  });

  it('rechaza un monto negativo', async () => {
    const negativo = xml32.replace(/<MontoTotal>[^<]*<\/MontoTotal>/, '<MontoTotal>-1.00</MontoTotal>');
    const resultado = await validarContraXSD(negativo, esquema32);
    expect(resultado.valido).toBe(false);
    expect(resultado.errores.join(' ')).toMatch(/MontoTotal/);
  });

  // Un esquema roto no es culpa de la factura: no se disfraza de XML inválido.
  it('lanza, en vez de responder inválido, cuando el esquema no compila', async () => {
    const roto =
      '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">' +
      '<xs:element name="ECF" type="TipoQueNoExiste"/></xs:schema>';
    await expect(validarContraXSD(xml32, roto)).rejects.toThrow(/TipoQueNoExiste/);
  });
});

describe('la definición que le falta al XSD 31 de DGII', () => {
  // Cuando esta prueba se ponga roja, DGII corrigió su esquema y el parche sobra.
  it('el XSD 31 publicado sigue sin compilar por su cuenta', async () => {
    await expect(validateXML({ xml: xml31, schema: esquema31 })).rejects.toThrow(
      /IndicadorServicioTodoIncluidoType/
    );
  });

  it('agrega, antes del cierre, exactamente la definición del XSD 33', () => {
    const definicion33 = esquema('e-CF 33 v.1.0.xsd').match(
      /[ \t]*<xs:simpleType name="IndicadorServicioTodoIncluidoType">[\s\S]*?<\/xs:simpleType>\r?\n/
    )?.[0];
    expect(definicion33).toBeDefined();
    const cierre = esquema31.lastIndexOf('</xs:schema>');
    expect(completarEsquema(esquema31)).toBe(
      esquema31.slice(0, cierre) + definicion33 + esquema31.slice(cierre)
    );
  });

  it('no toca un esquema que ya define el tipo', () => {
    expect(completarEsquema(esquema32)).toBe(esquema32);
  });

  it('no toca un esquema que no usa el tipo', () => {
    const esquema41 = esquema('e-CF 41 v.1.0.xsd');
    expect(completarEsquema(esquema41)).toBe(esquema41);
  });
});

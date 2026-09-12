import { DOMParser } from '@xmldom/xmldom';

// Informe Técnico e-CF v1.0, sección 18 (págs. 31–40): lo que va en la representación impresa
// de un e-CF y cómo se consulta desde su código QR. Todo sale del XML firmado, tal como se
// guardó.

const CAMPOS_TOTALES = [
  'MontoGravadoTotal',
  'MontoGravadoI1',
  'MontoGravadoI2',
  'MontoGravadoI3',
  'MontoExento',
  'ITBIS1',
  'ITBIS2',
  'ITBIS3',
  'TotalITBIS',
  'TotalITBIS1',
  'TotalITBIS2',
  'TotalITBIS3',
  'MontoTotal',
] as const;

type CampoTotal = (typeof CAMPOS_TOTALES)[number];

export interface ItemImpreso {
  NumeroLinea: string;
  IndicadorFacturacion: string;
  NombreItem: string;
  CantidadItem: string;
  PrecioUnitarioItem: string;
  DescuentoMonto?: string;
  RecargoMonto?: string;
  MontoItem: string;
}

export interface DatosDeRepresentacion {
  TipoeCF: string;
  eNCF: string;
  FechaVencimientoSecuencia?: string;
  Emisor: {
    RNCEmisor: string;
    RazonSocialEmisor: string;
    DireccionEmisor: string;
    FechaEmision: string;
  };
  Comprador?: { RNCComprador?: string; RazonSocialComprador?: string };
  Items: ItemImpreso[];
  Totales: Partial<Record<CampoTotal, string>> & { MontoTotal: string };
  FechaHoraFirma: string;
  SignatureValue: string;
}

// Los nombres del e-CF no se repiten entre áreas, así que basta el primero del subárbol.
function texto(padre: Document | Element, nombre: string): string | undefined {
  return padre.getElementsByTagName(nombre)[0]?.textContent ?? undefined;
}

function obligatorio(padre: Document | Element, nombre: string): string {
  const valor = texto(padre, nombre);
  if (valor === undefined) throw new Error(`El e-CF no trae ${nombre}.`);
  return valor;
}

function opcionales<T extends string>(padre: Document | Element, nombres: readonly T[]) {
  return Object.fromEntries(
    nombres.flatMap((nombre) => {
      const valor = texto(padre, nombre);
      return valor === undefined ? [] : [[nombre, valor]];
    })
  ) as Partial<Record<T, string>>;
}

export function leerComprobanteFirmado(xml: string): DatosDeRepresentacion {
  const fallar = (mensaje: string) => {
    throw new Error(`XML mal formado: ${mensaje}`);
  };
  const documento = new DOMParser({
    errorHandler: { warning: () => undefined, error: fallar, fatalError: fallar },
  }).parseFromString(xml, 'text/xml');

  const SignatureValue = texto(documento, 'SignatureValue');
  if (SignatureValue === undefined) {
    throw new Error('El e-CF no trae firma, y la representación impresa sale de un e-CF firmado.');
  }

  const comprador = documento.getElementsByTagName('Comprador')[0];
  const Comprador = comprador
    ? opcionales(comprador, ['RNCComprador', 'RazonSocialComprador'] as const)
    : {};
  const nodos = documento.getElementsByTagName('Item');
  const Items = Array.from({ length: nodos.length }, (_, i): ItemImpreso => {
    const item = nodos[i];
    return {
      NumeroLinea: obligatorio(item, 'NumeroLinea'),
      IndicadorFacturacion: obligatorio(item, 'IndicadorFacturacion'),
      NombreItem: obligatorio(item, 'NombreItem'),
      CantidadItem: obligatorio(item, 'CantidadItem'),
      PrecioUnitarioItem: obligatorio(item, 'PrecioUnitarioItem'),
      ...opcionales(item, ['DescuentoMonto', 'RecargoMonto'] as const),
      MontoItem: obligatorio(item, 'MontoItem'),
    };
  });

  return {
    TipoeCF: obligatorio(documento, 'TipoeCF'),
    eNCF: obligatorio(documento, 'eNCF'),
    ...opcionales(documento, ['FechaVencimientoSecuencia'] as const),
    Emisor: {
      RNCEmisor: obligatorio(documento, 'RNCEmisor'),
      RazonSocialEmisor: obligatorio(documento, 'RazonSocialEmisor'),
      DireccionEmisor: obligatorio(documento, 'DireccionEmisor'),
      FechaEmision: obligatorio(documento, 'FechaEmision'),
    },
    ...(Object.keys(Comprador).length === 0 ? {} : { Comprador }),
    Items,
    Totales: {
      ...opcionales(documento, CAMPOS_TOTALES),
      MontoTotal: obligatorio(documento, 'MontoTotal'),
    },
    FechaHoraFirma: obligatorio(documento, 'FechaHoraFirma'),
    SignatureValue,
  };
}

// Informe Técnico, pág. 36: "los primeros seis (6) dígitos del hash generado en el
// SignatureValue". Los modelos de las págs. 38–40 imprimen códigos como "C78q+V", que son los
// primeros seis caracteres del SignatureValue, en base64.
export function codigoDeSeguridad(signatureValue: string): string {
  if (signatureValue.length < 6) {
    throw new Error('El SignatureValue tiene menos de seis caracteres.');
  }
  return signatureValue.slice(0, 6);
}

// Informe Técnico, pág. 36: la factura de consumo menor a DOP$250,000.00 se consulta en otro
// servicio y con menos parámetros. En centavos.
const UMBRAL_CONSUMO = BigInt(25_000_000);

// Cada valor va codificado; el ":" de la hora se deja como en el ejemplo de DGII.
const parametros = (pares: [string, string][]) =>
  pares
    .map(([nombre, valor]) => `${nombre}=${encodeURIComponent(valor).replace(/%3A/g, ':')}`)
    .join('&');

export function urlDeConsulta(datos: DatosDeRepresentacion): string {
  const { Emisor, eNCF, Totales } = datos;
  const monto = Totales.MontoTotal;
  if (!/^\d+\.\d{2}$/.test(monto)) throw new Error(`MontoTotal inválido: ${monto}.`);
  const CodigoSeguridad = codigoDeSeguridad(datos.SignatureValue);

  if (datos.TipoeCF === '32' && BigInt(monto.replace('.', '')) < UMBRAL_CONSUMO) {
    return `https://fc.dgii.gov.do/eCF/ConsultaTimbreFC?${parametros([
      ['RncEmisor', Emisor.RNCEmisor],
      ['ENCF', eNCF],
      ['MontoTotal', monto],
      ['CodigoSeguridad', CodigoSeguridad],
    ])}`;
  }

  const RncComprador = datos.Comprador?.RNCComprador;
  if (RncComprador === undefined) {
    throw new Error(`La consulta de ${eNCF} lleva RncComprador, y el e-CF no lo trae.`);
  }
  return `https://ecf.dgii.gov.do/ecf/ConsultaTimbre?${parametros([
    ['RncEmisor', Emisor.RNCEmisor],
    ['RncComprador', RncComprador],
    ['ENCF', eNCF],
    ['FechaEmision', Emisor.FechaEmision],
    ['MontoTotal', monto],
    ['FechaFirma', datos.FechaHoraFirma],
    ['CodigoSeguridad', CodigoSeguridad],
  ])}`;
}

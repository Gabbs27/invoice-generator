import {
  calcularMontoItem,
  calcularTotales,
  type Linea,
  type TasasITBIS,
  type Totales,
} from './calculo';
import { parsearENCF } from './encf';
import { esIdentificacionValida } from './identificacion';

// Nombres y orden: esquemas/e-CF 31 v.1.0.xsd y e-CF 32 v.1.0.xsd. El XML sale sin
// firmar: lleva FechaHoraFirma, y la Signature la agrega quien firma.

export interface ItemComprobante extends Linea {
  NombreItem: string;
  IndicadorBienoServicio: 1 | 2;
}

export interface Comprobante {
  // El tipo sale del e-NCF, así los dos no pueden contradecirse.
  eNCF: string;
  // Obligatorio en el 31; el XSD del 32 no lo define.
  FechaVencimientoSecuencia?: string;
  IndicadorMontoGravado: 0 | 1;
  TipoIngresos: '01' | '02' | '03' | '04' | '05' | '06';
  TipoPago: 1 | 2 | 3;
  Emisor: {
    RNCEmisor: string;
    RazonSocialEmisor: string;
    DireccionEmisor: string;
    FechaEmision: string;
  };
  Comprador?: {
    RNCComprador: string;
    RazonSocialComprador: string;
  };
  Items: ItemComprobante[];
  FechaHoraFirma: string;
  tasas?: TasasITBIS;
}

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
] as const satisfies readonly (keyof Totales)[];

// Formato e-CF, págs. 12–13: desde DOP$250,000.00 la factura de consumo identifica al
// comprador. En centavos.
const UMBRAL_COMPRADOR_CONSUMO = BigInt(25_000_000);

const elemento = (nombre: string, contenido: string) => `<${nombre}>${contenido}</${nombre}>`;

function texto(valor: string, campo: string, maximo: number): string {
  const caracteres = typeof valor === 'string' ? [...valor] : [];
  if (caracteres.length < 1 || caracteres.length > maximo) {
    throw new Error(`${campo} tiene que tener entre 1 y ${maximo} caracteres.`);
  }
  // XML 1.0 no admite caracteres de control, salvo tabulador, salto de línea y retorno.
  const hayControl = caracteres.some((caracter) => {
    const punto = caracter.codePointAt(0) ?? 0;
    return punto < 0x20 && punto !== 0x09 && punto !== 0x0a && punto !== 0x0d;
  });
  if (hayControl) throw new Error(`${campo} tiene un carácter de control que XML no admite.`);
  return valor.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function rnc(valor: string, campo: string): string {
  if (!esIdentificacionValida(valor)) {
    throw new Error(`${campo} inválido: ${valor}. Son 9 u 11 dígitos.`);
  }
  return valor;
}

// Formato e-CF: las fechas van dd-MM-AAAA y tienen que existir.
function fecha(valor: string, campo: string): string {
  const partes = valor.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  const [dia, mes, anio] = partes ? partes.slice(1).map(Number) : [0, 0, 0];
  const calendario = new Date(Date.UTC(anio, mes - 1, dia));
  if (
    !partes ||
    calendario.getUTCFullYear() !== anio ||
    calendario.getUTCMonth() !== mes - 1 ||
    calendario.getUTCDate() !== dia
  ) {
    throw new Error(`${campo} inválida: ${valor}. Formato dd-MM-AAAA.`);
  }
  return valor;
}

function fechaHora(valor: string, campo: string): string {
  const partes = valor.match(/^(\d{2}-\d{2}-\d{4}) ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/);
  if (!partes) throw new Error(`${campo} inválida: ${valor}. Formato dd-MM-AAAA HH:mm:ss.`);
  fecha(partes[1], campo);
  return valor;
}

export function construirXML(comprobante: Comprobante): string {
  const { eNCF, Emisor, Comprador, Items } = comprobante;
  const { tipo } = parsearENCF(eNCF);
  if (tipo !== '31' && tipo !== '32') {
    throw new Error(`Esta versión todavía no arma e-CF tipo ${tipo}.`);
  }
  const vencimiento = comprobante.FechaVencimientoSecuencia;
  if (tipo === '31' && vencimiento === undefined) {
    throw new Error('La factura de crédito fiscal (31) lleva FechaVencimientoSecuencia.');
  }
  if (tipo === '32' && vencimiento !== undefined) {
    throw new Error('La factura de consumo (32) no lleva FechaVencimientoSecuencia.');
  }
  // Formato e-CF, pág. 9: FechaLimitePago es condicional a que el tipo de pago sea a
  // crédito, y esta versión todavía no la arma.
  if (comprobante.TipoPago === 2) {
    throw new Error(
      'Una factura a crédito (TipoPago 2) lleva FechaLimitePago, y esta versión todavía no la arma.'
    );
  }
  if (Items.length > 1000) throw new Error('Un e-CF lleva como máximo 1000 ítems.');

  const totales = calcularTotales(Items, {
    IndicadorMontoGravado: comprobante.IndicadorMontoGravado,
    tasas: comprobante.tasas,
  });

  if (tipo === '31' && Comprador === undefined) {
    throw new Error('La factura de crédito fiscal (31) identifica al comprador.');
  }
  const montoTotal = BigInt(totales.MontoTotal.replace('.', ''));
  if (tipo === '32' && Comprador === undefined && montoTotal >= UMBRAL_COMPRADOR_CONSUMO) {
    throw new Error('Una factura de consumo desde RD$250,000.00 identifica al comprador.');
  }

  // Formato e-CF, pág. 7: IndicadorMontoGravado es condicional a que haya ítems gravados.
  const hayGravados = Items.some((item) => item.IndicadorFacturacion !== 4);
  const idDoc =
    elemento('TipoeCF', tipo) +
    elemento('eNCF', eNCF) +
    (vencimiento === undefined
      ? ''
      : elemento('FechaVencimientoSecuencia', fecha(vencimiento, 'FechaVencimientoSecuencia'))) +
    (hayGravados
      ? elemento('IndicadorMontoGravado', String(comprobante.IndicadorMontoGravado))
      : '') +
    elemento('TipoIngresos', comprobante.TipoIngresos) +
    elemento('TipoPago', String(comprobante.TipoPago));

  const emisor =
    elemento('RNCEmisor', rnc(Emisor.RNCEmisor, 'RNCEmisor')) +
    elemento('RazonSocialEmisor', texto(Emisor.RazonSocialEmisor, 'RazonSocialEmisor', 150)) +
    elemento('DireccionEmisor', texto(Emisor.DireccionEmisor, 'DireccionEmisor', 100)) +
    elemento('FechaEmision', fecha(Emisor.FechaEmision, 'FechaEmision'));

  const comprador =
    Comprador === undefined
      ? ''
      : elemento('RNCComprador', rnc(Comprador.RNCComprador, 'RNCComprador')) +
        elemento(
          'RazonSocialComprador',
          texto(Comprador.RazonSocialComprador, 'RazonSocialComprador', 150)
        );

  const totalesXML = CAMPOS_TOTALES.filter((campo) => totales[campo] !== undefined)
    .map((campo) => elemento(campo, String(totales[campo])))
    .join('');

  const items = Items.map((item, indice) =>
    elemento(
      'Item',
      elemento('NumeroLinea', String(indice + 1)) +
        elemento('IndicadorFacturacion', String(item.IndicadorFacturacion)) +
        elemento('NombreItem', texto(item.NombreItem, 'NombreItem', 80)) +
        elemento('IndicadorBienoServicio', String(item.IndicadorBienoServicio)) +
        elemento('CantidadItem', item.CantidadItem) +
        elemento('PrecioUnitarioItem', item.PrecioUnitarioItem) +
        (item.DescuentoMonto === undefined
          ? ''
          : elemento('DescuentoMonto', item.DescuentoMonto) +
            elemento(
              'TablaSubDescuento',
              elemento(
                'SubDescuento',
                elemento('TipoSubDescuento', '$') +
                  elemento('MontoSubDescuento', item.DescuentoMonto)
              )
            )) +
        (item.RecargoMonto === undefined
          ? ''
          : elemento('RecargoMonto', item.RecargoMonto) +
            elemento(
              'TablaSubRecargo',
              elemento(
                'SubRecargo',
                elemento('TipoSubRecargo', '$') + elemento('MontoSubRecargo', item.RecargoMonto)
              )
            )) +
        elemento('MontoItem', calcularMontoItem(item))
    )
  ).join('');

  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    elemento(
      'ECF',
      elemento(
        'Encabezado',
        elemento('Version', '1.0') +
          elemento('IdDoc', idDoc) +
          elemento('Emisor', emisor) +
          elemento('Comprador', comprador) +
          elemento('Totales', totalesXML)
      ) +
        elemento('DetallesItems', items) +
        elemento('FechaHoraFirma', fechaHora(comprobante.FechaHoraFirma, 'FechaHoraFirma'))
    )
  );
}

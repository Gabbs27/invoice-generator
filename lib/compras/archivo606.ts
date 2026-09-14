import { tipoIdentificacion } from '../ecf/identificacion';
import { esPeriodo } from './fechas';
import { aCentavos, aMonto } from './montos';
import type { Compra } from './tipos';

// Instructivo del 606: hasta 10,000 registros por archivo.
export const MAXIMO_DE_REGISTROS = 10_000;

// Como GenerarArchivo en la herramienta 606: una línea por registro, sin salto después de la
// última. Los archivos que la Oficina Virtual aceptó separan las líneas con LF.
const FIN_DE_LINEA = '\n';

const CERO = BigInt(0);

// Lo que la NG 07-2018 no fija se escribe como la herramienta 606 de la DGII (sus macros) y los
// archivos suyos que la Oficina Virtual aceptó (docs/plans/2026-09-13-dgii-606-design.md, "Formato
// del archivo").
export const nombreDelArchivo606 = (rnc: string, periodo: string): string =>
  `DGII_F_606_${rnc}_${periodo}.TXT`;

// Dos decimales con punto, y nada cuando el monto es cero, como una celda en blanco.
const monto = (centavos: bigint) => (centavos === CERO ? '' : aMonto(centavos));

const opcional = (valor: string | undefined, campo: string) =>
  valor === undefined ? '' : monto(aCentavos(valor, campo));

// Las casillas 3, 17 y 23 son N 2: la herramienta escribe 09, no 9.
const codigo = (valor: string | undefined) => (valor === undefined ? '' : valor.padStart(2, '0'));

// Las 23 casillas en el orden de la NG 07-2018, Anexo A, separadas por barra vertical.
function detalle(compra: Compra): string {
  const servicios = aCentavos(compra.MontoServicios, 'Monto facturado en servicios');
  const bienes = aCentavos(compra.MontoBienes, 'Monto facturado en bienes');
  const itbis = aCentavos(compra.ITBISFacturado, 'ITBIS facturado');
  const alCosto =
    compra.ITBISCosto === undefined ? CERO : aCentavos(compra.ITBISCosto, 'ITBIS llevado al costo');
  return [
    compra.RNCCedula,
    tipoIdentificacion(compra.RNCCedula) === 'RNC' ? '1' : '2',
    codigo(compra.TipoBienesServicios),
    compra.NCF,
    compra.NCFModificado ?? '',
    compra.FechaComprobante,
    compra.FechaPago ?? '',
    monto(servicios),
    monto(bienes),
    // La herramienta calcula el total y el ITBIS por adelantar en cada fila y los escribe siempre.
    aMonto(servicios + bienes),
    monto(itbis),
    opcional(compra.ITBISRetenido, 'ITBIS retenido'),
    opcional(compra.ITBISProporcionalidad, 'ITBIS sujeto a proporcionalidad'),
    opcional(compra.ITBISCosto, 'ITBIS llevado al costo'),
    aMonto(itbis - alCosto),
    // ITBIS percibido en compras: la DGII no lo tiene habilitado.
    '',
    codigo(compra.TipoRetencionISR),
    opcional(compra.MontoRetencionRenta, 'Monto de retención de renta'),
    // ISR percibido en compras: tampoco.
    '',
    opcional(compra.ImpuestoSelectivo, 'Impuesto selectivo al consumo'),
    opcional(compra.OtrosImpuestos, 'Otros impuestos o tasas'),
    opcional(compra.PropinaLegal, 'Propina legal'),
    codigo(compra.FormaPago),
  ].join('|');
}

// El archivo que se sube a la Oficina Virtual. Las compras llegan validadas y ya elegidas para el
// periodo: aquí solo se escribe.
export function archivo606(rnc: string, periodo: string, compras: Compra[]): string {
  if (tipoIdentificacion(rnc) === null) throw new Error(`RNC o cédula del emisor inválido: ${rnc}.`);
  if (!esPeriodo(periodo)) throw new Error(`Periodo inválido: ${periodo}. Formato AAAAMM, desde 201805.`);
  if (compras.length === 0) {
    throw new Error('Un mes sin compras no lleva archivo: el 606 se presenta en cero en la Oficina Virtual.');
  }
  if (compras.length > MAXIMO_DE_REGISTROS) {
    throw new Error(
      `El 606 admite hasta ${MAXIMO_DE_REGISTROS} compras por archivo, y este mes tiene ${compras.length}.`
    );
  }
  return [`606|${rnc}|${periodo}|${compras.length}`, ...compras.map(detalle)].join(FIN_DE_LINEA);
}

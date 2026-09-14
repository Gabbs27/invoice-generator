import { tipoIdentificacion } from '../ecf/identificacion';
import { esFecha } from './fechas';
import { aCentavos, aMonto, esMonto } from './montos';
import { emitidoPorQuienCompra, leerNCFDeCompra, tieneFormaDeNCF } from './ncf';
import {
  esCodigo,
  FORMAS_DE_PAGO,
  TIPOS_DE_BIENES_Y_SERVICIOS,
  TIPOS_DE_RETENCION_ISR,
  type Compra,
} from './tipos';

const CERO = BigInt(0);

// Los nombres de las casillas del instructivo, para decir en qué campo está el error.
const MONTOS = {
  MontoServicios: 'Monto facturado en servicios',
  MontoBienes: 'Monto facturado en bienes',
  ITBISFacturado: 'ITBIS facturado',
  ITBISRetenido: 'ITBIS retenido',
  ITBISProporcionalidad: 'ITBIS sujeto a proporcionalidad',
  ITBISCosto: 'ITBIS llevado al costo',
  MontoRetencionRenta: 'Monto de retención de renta',
  ImpuestoSelectivo: 'Impuesto selectivo al consumo',
  OtrosImpuestos: 'Otros impuestos o tasas',
  PropinaLegal: 'Propina legal',
} as const satisfies Partial<Record<keyof Compra, string>>;

type CampoDeMonto = keyof typeof MONTOS;

// Las reglas del instructivo del Formato de Envío 606 (febrero de 2026) y de la herramienta 606 de
// la DGII. Devuelve todos los errores y no solo el primero, para corregirlos de una vez.
export function validarCompra(compra: Compra, rncDelNegocio: string): string[] {
  const errores: string[] = [];

  if (tipoIdentificacion(compra.RNCCedula) === null) {
    errores.push(`RNC o cédula del proveedor inválido: ${compra.RNCCedula}. Son 9 u 11 dígitos.`);
  }
  if (!esCodigo(TIPOS_DE_BIENES_Y_SERVICIOS, compra.TipoBienesServicios)) {
    errores.push(`Tipo de bienes y servicios inválido: ${compra.TipoBienesServicios}. Va del 1 al 11.`);
  }

  const ncf = leerNCFDeCompra(compra.NCF);
  if (!ncf.valido) errores.push(ncf.motivo);
  if (compra.NCFModificado !== undefined && !tieneFormaDeNCF(compra.NCFModificado)) {
    errores.push(`NCF modificado inválido: ${compra.NCFModificado}.`);
  }
  if (ncf.valido && ncf.esNota && compra.NCFModificado === undefined) {
    errores.push(`${compra.NCF} es una nota de débito o de crédito: lleva el NCF que modifica.`);
  }
  if (ncf.valido && !ncf.esNota && compra.NCFModificado !== undefined) {
    errores.push(`${compra.NCF} no es una nota: el NCF modificado va solo en notas de débito y de crédito.`);
  }
  // Los comprobantes de gastos menores y de pagos al exterior los emite quien reporta, así que la
  // casilla 1 lleva su propio RNC (ver emitidoPorQuienCompra en ncf.ts).
  const propio = ncf.valido ? emitidoPorQuienCompra(compra.NCF) : undefined;
  if (propio !== undefined && compra.RNCCedula !== rncDelNegocio) {
    errores.push(`${compra.NCF} es de ${propio}: va con el RNC del negocio, ${rncDelNegocio}.`);
  }

  if (!esFecha(compra.FechaComprobante)) {
    errores.push(`Fecha del comprobante inválida: ${compra.FechaComprobante}.`);
  }
  if (compra.FechaPago !== undefined && !esFecha(compra.FechaPago)) {
    errores.push(`Fecha de pago inválida: ${compra.FechaPago}.`);
  }

  const centavos: Partial<Record<CampoDeMonto, bigint>> = {};
  for (const campo of Object.keys(MONTOS) as CampoDeMonto[]) {
    const valor = compra[campo];
    if (valor === undefined) continue;
    if (esMonto(valor)) centavos[campo] = aCentavos(valor, MONTOS[campo]);
    else errores.push(`${MONTOS[campo]} inválido: ${valor}. Hasta 9 enteros y 2 decimales, con punto.`);
  }
  const monto = (campo: CampoDeMonto) => centavos[campo] ?? CERO;

  if (centavos.MontoServicios !== undefined && centavos.MontoBienes !== undefined) {
    const total = monto('MontoServicios') + monto('MontoBienes');
    if (total === CERO) errores.push('La compra no tiene monto: servicios y bienes están en cero.');
    if (aMonto(total).length > 12) {
      errores.push(`El total facturado, ${aMonto(total)}, no cabe en el 606: el máximo es 999999999.99.`);
    }
  }
  if (monto('ITBISCosto') > monto('ITBISFacturado')) {
    errores.push('El ITBIS llevado al costo no puede pasar del ITBIS facturado.');
  }
  if (monto('ITBISRetenido') > monto('ITBISFacturado')) {
    errores.push('El ITBIS retenido no puede pasar del ITBIS facturado.');
  }

  // Instructivo, casillas 12, 17 y 18: las retenciones piden la fecha de pago.
  const retieneISR = monto('MontoRetencionRenta') > CERO;
  if ((monto('ITBISRetenido') > CERO || retieneISR) && compra.FechaPago === undefined) {
    errores.push('Con retenciones, la compra lleva la fecha de pago.');
  }
  if (compra.TipoRetencionISR !== undefined && !esCodigo(TIPOS_DE_RETENCION_ISR, compra.TipoRetencionISR)) {
    errores.push(`Tipo de retención en ISR inválido: ${compra.TipoRetencionISR}. Va del 1 al 9.`);
  }
  if (retieneISR && compra.TipoRetencionISR === undefined) {
    errores.push('Con retención de ISR, la compra lleva el tipo de retención.');
  }
  if (!retieneISR && compra.TipoRetencionISR !== undefined) {
    errores.push('El tipo de retención en ISR va con un monto retenido.');
  }

  if (!esCodigo(FORMAS_DE_PAGO, compra.FormaPago)) {
    errores.push(`Forma de pago inválida: ${compra.FormaPago}. Va del 1 al 7.`);
  }
  return errores;
}

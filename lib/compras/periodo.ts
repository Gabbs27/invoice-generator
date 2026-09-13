import { esPeriodo, ultimoDiaDelPeriodo } from './fechas';
import { aCentavos, esMonto } from './montos';
import type { Compra } from './tipos';

const CERO = BigInt(0);

const positivo = (valor: string | undefined) =>
  valor !== undefined && esMonto(valor) && aCentavos(valor, 'Monto') > CERO;

const tieneRetenciones = (compra: Compra) =>
  positivo(compra.ITBISRetenido) || positivo(compra.MontoRetencionRenta);

// Sin pago dentro del mes, el comprobante sale sin fecha de pago y sin retenciones: esas se
// reportan en el mes en que se paga.
function sinPago(compra: Compra): Compra {
  const copia = { ...compra };
  delete copia.FechaPago;
  delete copia.ITBISRetenido;
  delete copia.TipoRetencionISR;
  delete copia.MontoRetencionRenta;
  return copia;
}

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const orden = (a: Compra, b: Compra) =>
  comparar(a.FechaComprobante, b.FechaComprobante) ||
  comparar(a.RNCCedula, b.RNCCedula) ||
  comparar(a.NCF, b.NCF);

// Lo que va en el 606 de un periodo AAAAMM:
// 1. Las compras con comprobante del periodo. Llevan fecha de pago y retenciones solo si el pago
//    no pasa del último día del periodo.
// 2. Las compras de periodos anteriores pagadas en este con alguna retención, con su fecha
//    original: el instructivo del 606 pide reenviar así el NCF para reportarlas.
export function comprasDelPeriodo(compras: Compra[], periodo: string): Compra[] {
  if (!esPeriodo(periodo)) {
    throw new Error(`Periodo inválido: ${periodo}. Formato AAAAMM, desde 201805.`);
  }
  const ultimoDia = ultimoDiaDelPeriodo(periodo);
  const lineas: Compra[] = [];
  for (const compra of compras) {
    const periodoDelComprobante = compra.FechaComprobante.slice(0, 6);
    if (periodoDelComprobante === periodo) {
      const pagadaEnElMes = compra.FechaPago !== undefined && compra.FechaPago <= ultimoDia;
      lineas.push(pagadaEnElMes ? compra : sinPago(compra));
    } else if (
      periodoDelComprobante < periodo &&
      compra.FechaPago?.slice(0, 6) === periodo &&
      tieneRetenciones(compra)
    ) {
      lineas.push(compra);
    }
  }
  return lineas.sort(orden);
}

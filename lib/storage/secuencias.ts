import { parsearENCF } from '../ecf/encf';
import type { TipoECF } from '../ecf/tipos';
import type { Emisor, RangoAutorizado } from './tipos';

// Las reglas de secuencia que comparten todas las implementaciones de Almacenamiento,
// para que la de memoria y la de archivos no puedan contar distinto.

function rangoDe(emisor: Emisor, tipo: TipoECF): RangoAutorizado {
  const rango = emisor.rangos[tipo];
  if (!rango) throw new Error(`No hay un rango autorizado para e-CF tipo ${tipo}.`);
  return rango;
}

// La próxima secuencia sale de lo emitido, no de un contador: la fuente de verdad es
// lo que se emitió.
export function siguienteSecuencia(emisor: Emisor, tipo: TipoECF, emitidos: string[]): number {
  const { desde, hasta } = rangoDe(emisor, tipo);
  const ultima = emitidos
    .map((encf) => parsearENCF(encf))
    .filter((emitido) => emitido.tipo === tipo)
    .reduce((mayor, emitido) => Math.max(mayor, emitido.secuencia), desde - 1);
  const siguiente = ultima + 1;
  if (siguiente > hasta) {
    throw new Error(`Se agotó el rango autorizado para e-CF tipo ${tipo}: llega hasta ${hasta}.`);
  }
  return siguiente;
}

export function comprobarQueSePuedeGuardar(emisor: Emisor, encf: string): void {
  const { tipo, secuencia } = parsearENCF(encf);
  const { desde, hasta } = rangoDe(emisor, tipo);
  if (secuencia < desde || secuencia > hasta) {
    throw new Error(`${encf} está fuera del rango autorizado (${desde} a ${hasta}).`);
  }
}

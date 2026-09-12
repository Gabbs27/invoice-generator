'use server';

import { refresh } from 'next/cache';
import { obtenerCredencial } from '@/lib/credencial';
import { emitirECF, type ResultadoDeEmision, type SolicitudDeEmision } from '@/lib/emitir';
import { leerEsquema } from '@/lib/esquemas';
import { leerSolicitud } from '@/lib/formulario';
import { modoDeEjecucion, obtenerAlmacenamiento } from '@/lib/storage';

export async function emitir(datos: FormData): Promise<ResultadoDeEmision> {
  let solicitud: SolicitudDeEmision;
  try {
    solicitud = leerSolicitud(datos);
  } catch (error) {
    return { emitido: false, errores: [(error as Error).message] };
  }
  const resultado = await emitirECF(solicitud, {
    almacenamiento: obtenerAlmacenamiento(),
    credencial: () => obtenerCredencial(modoDeEjecucion()),
    leerEsquema,
  });
  // La página muestra el próximo e-NCF, y acaba de cambiar.
  if (resultado.emitido) refresh();
  return resultado;
}

'use server';

import { renderToBuffer } from '@react-pdf/renderer';
import { refresh } from 'next/cache';
import { obtenerCredencial } from '@/lib/credencial';
import { leerComprobanteFirmado } from '@/lib/ecf/representacion';
import { emitirECF, type ResultadoDeEmision, type SolicitudDeEmision } from '@/lib/emitir';
import { leerEsquema } from '@/lib/esquemas';
import { leerSolicitud } from '@/lib/formulario';
import { modoDeEjecucion, obtenerAlmacenamiento } from '@/lib/storage';
import { documentoImpreso } from './facturas/[encf]/documento';

// En la demostración lo emitido trae además su representación impresa, en base64: en Vercel la
// ruta /facturas corre en otra función, sin la memoria donde quedó guardado.
export type ResultadoDeLaAccion = ResultadoDeEmision & { pdf?: string };

export async function emitir(datos: FormData): Promise<ResultadoDeLaAccion> {
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
  if (!resultado.emitido) return resultado;

  // La página muestra el próximo e-NCF, y acaba de cambiar.
  refresh();
  if (modoDeEjecucion() !== 'demostracion') return resultado;
  try {
    const pdf = await renderToBuffer(
      documentoImpreso(leerComprobanteFirmado(resultado.xml), true)
    );
    return { ...resultado, pdf: Buffer.from(pdf).toString('base64') };
  } catch (error) {
    // Lo emitido ya quedó guardado: sin PDF, el resultado sigue siendo el de la emisión.
    console.error('No se pudo generar la representación impresa:', error);
    return resultado;
  }
}

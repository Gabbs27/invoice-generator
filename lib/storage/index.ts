import { join } from 'node:path';
import { AlmacenamientoEnArchivos } from './archivos';
import { AlmacenamientoEnMemoria } from './memoria';
import type { Almacenamiento, Emisor } from './tipos';

export type Modo = 'local' | 'demostracion';

// Vercel define VERCEL=1, y su disco es efímero: guardar en archivos ahí parecería
// funcionar y perdería todo. Allí la aplicación es una demostración en memoria.
export function modoDeEjecucion(entorno: Record<string, string | undefined> = process.env): Modo {
  return entorno.VERCEL ? 'demostracion' : 'local';
}

// El emisor de la demostración no es de nadie: RNC de ceros, y lo dice en el nombre.
export const EMISOR_DE_DEMOSTRACION: Emisor = {
  RNCEmisor: '000000000',
  RazonSocialEmisor: 'Negocio de demostración, sin valor fiscal',
  DireccionEmisor: 'Demostración',
  rangos: {
    '31': { desde: 1, hasta: 9_999_999_999, FechaVencimientoSecuencia: '31-12-2099' },
    '32': { desde: 1, hasta: 9_999_999_999, FechaVencimientoSecuencia: '31-12-2099' },
  },
};

export function crearAlmacenamiento(
  modo: Modo,
  directorio = join(process.cwd(), 'datos')
): Almacenamiento {
  return modo === 'demostracion'
    ? new AlmacenamientoEnMemoria(EMISOR_DE_DEMOSTRACION)
    : new AlmacenamientoEnArchivos(directorio);
}

// Uno por proceso: en memoria, lo emitido tiene que durar de una petición a la siguiente. Y
// va en globalThis porque Next carga cada ruta con su propia copia de este módulo: con una
// variable del módulo, la página que emite y la ruta que imprime tendrían almacenamientos
// distintos.
export const CLAVE_DEL_PROCESO = '__invoiceGeneratorAlmacenamiento';

export function obtenerAlmacenamiento(): Almacenamiento {
  const proceso = globalThis as unknown as Record<string, Almacenamiento | undefined>;
  return (proceso[CLAVE_DEL_PROCESO] ??= crearAlmacenamiento(modoDeEjecucion()));
}

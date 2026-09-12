import { renderToBuffer } from '@react-pdf/renderer';
import { leerComprobanteFirmado } from '@/lib/ecf/representacion';
import { modoDeEjecucion, obtenerAlmacenamiento } from '@/lib/storage';
import { documentoImpreso } from './documento';

// La representación impresa sale del XML que se guardó al emitir: imprime lo que se firmó.
export async function GET(_solicitud: Request, contexto: RouteContext<'/facturas/[encf]'>) {
  const { encf } = await contexto.params;
  let xml: string;
  try {
    // leerComprobante valida el e-NCF antes de tocar el almacenamiento.
    xml = await obtenerAlmacenamiento().leerComprobante(encf);
  } catch (error) {
    return new Response((error as Error).message, { status: 404 });
  }
  const pdf = await renderToBuffer(
    documentoImpreso(leerComprobanteFirmado(xml), modoDeEjecucion() === 'demostracion')
  );
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${encf}.pdf"`,
    },
  });
}

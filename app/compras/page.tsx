import { connection } from 'next/server';
import { esPeriodo, periodoEnRD } from '@/lib/compras/fechas';
import { comprasDelPeriodo } from '@/lib/compras/periodo';
import { claveDeCompra, type Compra } from '@/lib/compras/tipos';
import { modoDeEjecucion, obtenerAlmacenamiento } from '@/lib/storage';
import { Membrete } from '../membrete';
import estilos from '../pagina.module.css';
import { Compras } from './compras';

export default async function PaginaDeCompras({ searchParams }: PageProps<'/compras'>) {
  // Las compras se leen en cada visita: nada de esto se prerenderiza.
  await connection();
  const { periodo: pedido } = await searchParams;
  const periodo =
    typeof pedido === 'string' && esPeriodo(pedido) ? pedido : periodoEnRD(new Date());
  const modo = modoDeEjecucion();
  const almacenamiento = obtenerAlmacenamiento();
  const emisor = await almacenamiento.leerEmisor().catch((error: Error) => error);
  const todas = emisor instanceof Error ? [] : await almacenamiento.listarCompras();
  const lineas = comprasDelPeriodo(todas, periodo);
  // Una línea del mes puede venir sin pago ni retenciones (comprasDelPeriodo): para corregir hace
  // falta la compra completa.
  const completas: Record<string, Compra> = Object.fromEntries(
    todas.map((compra) => [claveDeCompra(compra), compra])
  );

  return (
    <main className={estilos.hoja}>
      <Membrete actual="/compras" antetitulo="Formato de Envío 606" modo={modo}>
        Compras <em>del mes</em>
      </Membrete>
      {emisor instanceof Error ? (
        <section className={estilos.sinEmisor}>
          <h2>No se pudo leer el emisor</h2>
          <p>{emisor.message}</p>
        </section>
      ) : (
        <Compras periodo={periodo} lineas={lineas} completas={completas} />
      )}
    </main>
  );
}

import { connection } from 'next/server';
import { esPeriodo, periodoEnRD } from '@/lib/compras/fechas';
import { comprasDelPeriodo } from '@/lib/compras/periodo';
import { claveDeCompra, type Compra } from '@/lib/compras/tipos';
import { modoDeEjecucion, obtenerAlmacenamiento } from '@/lib/storage';
import { Membrete } from '../membrete';
import estilos from '../pagina.module.css';
import { Compras } from './compras';

type MesLeido =
  | { titulo: string; error: Error }
  | { lineas: Compra[]; completas: Record<string, Compra> };

async function leerElMes(periodo: string): Promise<MesLeido> {
  const almacenamiento = obtenerAlmacenamiento();
  try {
    await almacenamiento.leerEmisor();
  } catch (error) {
    return { titulo: 'No se pudo leer el emisor', error: error as Error };
  }
  try {
    const todas = await almacenamiento.listarCompras();
    const lineas = comprasDelPeriodo(todas, periodo);
    // Una línea del mes puede venir sin pago ni retenciones (comprasDelPeriodo): para corregir hace
    // falta la compra completa. Solo viajan al navegador las de este mes.
    const delMes = new Set(lineas.map(claveDeCompra));
    const completas: Record<string, Compra> = Object.fromEntries(
      todas
        .filter((compra) => delMes.has(claveDeCompra(compra)))
        .map((compra) => [claveDeCompra(compra), compra])
    );
    return { lineas, completas };
  } catch (error) {
    // Un archivo de compra editado a mano y roto no tumba la página: se dice cuál es.
    return { titulo: 'No se pudieron leer las compras', error: error as Error };
  }
}

export default async function PaginaDeCompras({ searchParams }: PageProps<'/compras'>) {
  // Las compras se leen en cada visita: nada de esto se prerenderiza.
  await connection();
  const { periodo: pedido } = await searchParams;
  const periodo =
    typeof pedido === 'string' && esPeriodo(pedido) ? pedido : periodoEnRD(new Date());
  const mes = await leerElMes(periodo);

  return (
    <main className={estilos.hoja}>
      <Membrete actual="/compras" antetitulo="Formato de Envío 606" modo={modoDeEjecucion()}>
        Compras <em>del mes</em>
      </Membrete>
      {'error' in mes ? (
        <section className={estilos.sinEmisor}>
          <h2>{mes.titulo}</h2>
          <p>{mes.error.message}</p>
        </section>
      ) : (
        // Next conserva el estado del navegador al cambiar ?periodo=: con la llave, cada mes
        // empieza limpio y no muestra el 606 ni los avisos de otro.
        <Compras
          key={periodo}
          periodo={periodo}
          modo={modoDeEjecucion()}
          lineas={mes.lineas}
          completas={mes.completas}
        />
      )}
    </main>
  );
}

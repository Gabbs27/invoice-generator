'use client';

import Link from 'next/link';
import { startTransition, useActionState, type ReactNode } from 'react';
import {
  esPeriodo,
  nombreDelPeriodo,
  periodoAnterior,
  periodoSiguiente,
} from '@/lib/compras/fechas';
import { aCentavos, aMonto } from '@/lib/compras/montos';
import { claveDeCompra, FORMAS_DE_PAGO, type Compra } from '@/lib/compras/tipos';
import { conMiles } from '@/lib/formato';
import emision from '../emision.module.css';
import { Titulo } from '../partes';
import { generar606, type ResultadoDel606 } from './acciones';
import estilos from './compras.module.css';

const fechaLegible = (fecha: string) =>
  `${fecha.slice(6, 8)}/${fecha.slice(4, 6)}/${fecha.slice(0, 4)}`;

// Lo guardado puede venir editado a mano en datos/: si no es un monto, se muestra tal cual.
function montoLegible(...valores: string[]): string {
  try {
    const centavos = valores.reduce((total, valor) => total + aCentavos(valor, 'Monto'), BigInt(0));
    return conMiles(aMonto(centavos));
  } catch {
    return valores.join(' + ');
  }
}

export function Compras({
  periodo,
  lineas,
  completas,
}: {
  periodo: string;
  lineas: Compra[];
  completas: Record<string, Compra>;
}) {
  return (
    <div className={estilos.compras}>
      <Periodo periodo={periodo} />
      <section className={emision.seccion} aria-labelledby="titulo-lista">
        <Titulo id="titulo-lista" letra="B">
          Compras de {nombreDelPeriodo(periodo)}
        </Titulo>
        <Lista periodo={periodo} lineas={lineas} />
      </section>
      <Bajar606 periodo={periodo} hayCompras={lineas.length > 0} />
      {/* completas se usa desde la Tarea 15. */}
      <span hidden>{Object.keys(completas).length}</span>
    </div>
  );
}

function Periodo({ periodo }: { periodo: string }) {
  const anterior = periodoAnterior(periodo);
  const siguiente = periodoSiguiente(periodo);
  return (
    <nav aria-label="Mes" className={estilos.periodo}>
      {esPeriodo(anterior) ? (
        <Link href={`/compras?periodo=${anterior}`}>← {nombreDelPeriodo(anterior)}</Link>
      ) : (
        <span />
      )}
      <p className={estilos.mes}>{nombreDelPeriodo(periodo)}</p>
      <Link href={`/compras?periodo=${siguiente}`}>{nombreDelPeriodo(siguiente)} →</Link>
    </nav>
  );
}

export function Lista({
  periodo,
  lineas,
  acciones,
}: {
  periodo: string;
  lineas: Compra[];
  acciones?: (compra: Compra) => ReactNode;
}) {
  if (lineas.length === 0) {
    return (
      <p className={emision.ayuda}>No hay compras anotadas en {nombreDelPeriodo(periodo)}.</p>
    );
  }
  return (
    <div className={emision.tablaContenedor}>
      <table className={emision.tabla}>
        <thead>
          <tr>
            <th scope="col">Fecha</th>
            <th scope="col">Proveedor</th>
            <th scope="col">NCF</th>
            <th scope="col" className={emision.derecha}>
              Monto
            </th>
            <th scope="col" className={emision.derecha}>
              ITBIS
            </th>
            <th scope="col">Forma de pago</th>
            {acciones && (
              <th scope="col">
                <span className={emision.oculto}>Acciones</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {lineas.map((compra) => {
            // Una compra de un mes anterior está aquí porque se pagó este mes con retención.
            const reenvio = compra.FechaComprobante.slice(0, 6) !== periodo;
            return (
              <tr key={claveDeCompra(compra)} className={emision.fila}>
                <td className={emision.cifra}>{fechaLegible(compra.FechaComprobante)}</td>
                <td className={emision.cifra}>{compra.RNCCedula}</td>
                <td className={emision.cifra}>
                  {compra.NCF}
                  {reenvio && (
                    <span className={estilos.reenvio}>
                      Reenvío por retención: pagada el {fechaLegible(compra.FechaPago ?? '')}
                    </span>
                  )}
                </td>
                <td className={emision.monto}>
                  {montoLegible(compra.MontoServicios, compra.MontoBienes)}
                </td>
                <td className={emision.monto}>{montoLegible(compra.ITBISFacturado)}</td>
                <td>{FORMAS_DE_PAGO[compra.FormaPago] ?? compra.FormaPago}</td>
                {acciones && <td className={estilos.acciones}>{acciones(compra)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// El TXT llega en la respuesta de la acción y se guarda desde la página.
function bajar(nombre: string, contenido: string) {
  const url = URL.createObjectURL(new Blob([contenido], { type: 'text/plain' }));
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  enlace.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Bajar606({ periodo, hayCompras }: { periodo: string; hayCompras: boolean }) {
  const [resultado, accion, generando] = useActionState<ResultadoDel606 | null, void>(
    async () => {
      const nuevo = await generar606(periodo);
      if (nuevo.generado) bajar(nuevo.nombre, nuevo.contenido);
      return nuevo;
    },
    null
  );

  return (
    <section className={emision.seccion} aria-labelledby="titulo-606">
      <Titulo id="titulo-606" letra="C" nota="El archivo que se sube a la Oficina Virtual.">
        Formato 606 de {nombreDelPeriodo(periodo)}
      </Titulo>
      {hayCompras ? (
        <button
          type="button"
          onClick={() => startTransition(() => accion())}
          disabled={generando}
          className={emision.boton}
        >
          {generando ? 'Generando…' : 'Bajar el 606'}
        </button>
      ) : (
        <p className={emision.ayuda}>
          Un mes sin compras no lleva archivo: el 606 se presenta en cero en la Oficina Virtual.
        </p>
      )}
      <div aria-live="polite">
        {resultado?.generado === true && (
          <p className={emision.ayuda}>
            Se bajó {resultado.nombre}. Lo que solo la DGII puede comprobar (que el proveedor esté
            activo, que el NCF esté autorizado, que el e-CF haya sido aceptado) aparece cuando procesa
            el envío.
          </p>
        )}
        {resultado?.generado === false && (
          <div className={emision.fallido}>
            <h3>No se generó el 606</h3>
            <ul>
              {resultado.errores.map((error, indice) => (
                <li key={indice}>{error}</li>
              ))}
            </ul>
            <p>Corrige esas compras y vuelve a generarlo.</p>
          </div>
        )}
      </div>
    </section>
  );
}

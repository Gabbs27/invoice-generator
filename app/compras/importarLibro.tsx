'use client';

import { startTransition, useActionState, useState } from 'react';
import {
  comprasElegidas,
  evaluarFila,
  type Clase,
  type EleccionDeFila,
  type EstadoDeFila,
  type FilaDeGastos,
} from '@/lib/compras/desdeExcel';
import { fechaLegible } from '@/lib/compras/fechas';
import { LIBRO_DEMASIADO_GRANDE, TAMANO_MAXIMO_DEL_LIBRO } from '@/lib/compras/limites';
import {
  FORMAS_DE_PAGO,
  TIPOS_DE_BIENES_Y_SERVICIOS,
  type Compra,
  type FormaPago,
  type TipoBienesServicios,
} from '@/lib/compras/tipos';
import { conMiles } from '@/lib/formato';
import type { Modo } from '@/lib/storage';
import emision from '../emision.module.css';
import { Campo, SIN_RESPUESTA } from '../partes';
import {
  guardarComprasDelLibro,
  leerLibroDeGastos,
  type ResultadoDeGuardarDelLibro,
  type ResultadoDeLeerElLibro,
} from './acciones';
import estilos from './compras.module.css';

type LibroLeido = Extract<ResultadoDeLeerElLibro, { leido: true }>;
type Guardado = Extract<ResultadoDeGuardarDelLibro, { guardado: true }>;

// Un monto que el libro no dejó leer llega vacío.
const monto = (valor: string) => (valor === '' ? '—' : conMiles(valor));
const formaElegida = (valor: string) => (valor === '' ? undefined : (valor as FormaPago));

export function ImportarLibro({ periodo, modo }: { periodo: string; modo: Modo }) {
  // Cada lectura monta una vista previa nueva, sin las elecciones de la anterior.
  const [lecturas, setLecturas] = useState(0);
  const [libro, setLibro] = useState<LibroLeido | null>(null);
  const [resultado, leer, leyendo] = useActionState<ResultadoDeLeerElLibro | null, FormData>(
    async (_anterior, datos) => {
      // Un archivo de más no llega a la acción: Next la rechaza antes, sin decir por qué.
      const archivo = datos.get('libro');
      if (archivo instanceof File && archivo.size > TAMANO_MAXIMO_DEL_LIBRO) {
        return { leido: false, errores: [LIBRO_DEMASIADO_GRANDE] };
      }
      try {
        const nuevo = await leerLibroDeGastos(datos);
        if (nuevo.leido) {
          setLibro(nuevo);
          setLecturas((cuenta) => cuenta + 1);
        }
        return nuevo;
      } catch {
        return { leido: false, errores: [SIN_RESPUESTA] };
      }
    },
    null
  );
  const enDemostracion = modo === 'demostracion';

  return (
    <>
      <form
        onSubmit={(evento) => {
          evento.preventDefault();
          const datos = new FormData(evento.currentTarget);
          startTransition(() => leer(datos));
        }}
        className={estilos.importar}
      >
        <label htmlFor="libro-de-gastos" className={emision.etiqueta}>
          Libro de gastos (.xlsx)
        </label>
        <input
          id="libro-de-gastos"
          type="file"
          name="libro"
          accept=".xlsx"
          required
          disabled={enDemostracion}
          aria-describedby={enDemostracion ? 'libro-de-gastos-ayuda' : undefined}
        />
        <input type="hidden" name="periodo" value={periodo} />
        <button type="submit" disabled={enDemostracion || leyendo} className={estilos.secundario}>
          {leyendo ? 'Leyendo…' : 'Leer el libro'}
        </button>
        {enDemostracion && (
          <p id="libro-de-gastos-ayuda" className={`${emision.ayuda} ${estilos.resultadoDeImportar}`}>
            Solo en modo local: en la demostración, lo que se guarda lo ve cualquiera que entre, y un
            libro real mostraría proveedores y montos.
          </p>
        )}
        <div aria-live="polite" className={estilos.resultadoDeImportar}>
          {resultado?.leido === false && (
            <div className={emision.fallido}>
              <h3>No se pudo leer el libro</h3>
              <ul>
                {resultado.errores.map((error, indice) => (
                  <li key={indice}>{error}</li>
                ))}
              </ul>
              <p>No se anotó nada.</p>
            </div>
          )}
        </div>
      </form>
      {libro && <VistaPrevia key={lecturas} libro={libro} />}
    </>
  );
}

function VistaPrevia({ libro }: { libro: LibroLeido }) {
  const { hojas, propuesta } = libro.lectura;
  const [hoja, setHoja] = useState(propuesta);
  const [formaGeneral, setFormaGeneral] = useState<FormaPago | undefined>(undefined);
  const [elecciones, setElecciones] = useState<Record<number, EleccionDeFila>>({});
  const [guardado, guardar, guardando] = useActionState<ResultadoDeGuardarDelLibro | null, Compra[]>(
    async (_anterior, compras) => {
      try {
        return await guardarComprasDelLibro(compras);
      } catch {
        return { guardado: false, errores: [SIN_RESPUESTA] };
      }
    },
    null
  );

  if (guardado?.guardado === true) return <Resumen guardado={guardado} />;
  const actual = hojas[hoja];
  if (actual === undefined) return <p className={emision.ayuda}>El libro no tiene hojas.</p>;

  const opciones = { rncDelNegocio: libro.rncDelNegocio, formaGeneral };
  const estados = actual.filas.map((fila) => evaluarFila(fila, elecciones[fila.fila] ?? {}, opciones));
  const compras = comprasElegidas(actual.filas, elecciones, opciones);
  const cuantas = (...cuales: EstadoDeFila['estado'][]) =>
    estados.filter(({ estado }) => cuales.includes(estado)).length;
  const elegir = (fila: number, cambios: EleccionDeFila) =>
    setElecciones((antes) => ({ ...antes, [fila]: { ...antes[fila], ...cambios } }));

  return (
    <section aria-labelledby="titulo-del-libro" className={estilos.vistaPrevia}>
      <h3 id="titulo-del-libro" className={estilos.tituloDelLibro}>
        Compras del libro
      </h3>
      <div className={emision.campos}>
        <Campo id="hoja-del-libro" etiqueta="Hoja" codigo="Una por mes">
          <select
            id="hoja-del-libro"
            value={hoja}
            onChange={(evento) => {
              setHoja(Number(evento.target.value));
              setElecciones({});
            }}
            className={emision.entrada}
          >
            {hojas.map((unaHoja, indice) => (
              <option key={indice} value={indice}>
                {unaHoja.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <Campo
          id="forma-del-libro"
          etiqueta="Forma de pago de las demás filas"
          codigo="Casilla 23"
          ayuda="Para las filas sin método de pago cuyo proveedor no tiene compras anotadas."
        >
          <select
            id="forma-del-libro"
            value={formaGeneral ?? ''}
            onChange={(evento) => setFormaGeneral(formaElegida(evento.target.value))}
            aria-describedby="forma-del-libro-ayuda"
            className={emision.entrada}
          >
            <option value="">Sin elegir</option>
            {Object.entries(FORMAS_DE_PAGO).map(([codigo, nombre]) => (
              <option key={codigo} value={codigo}>
                {nombre}
              </option>
            ))}
          </select>
        </Campo>
      </div>

      {actual.motivo ? (
        <p className={emision.ayuda}>{actual.motivo}</p>
      ) : actual.filas.length === 0 ? (
        <p className={emision.ayuda}>Esta hoja no tiene compras con NCF.</p>
      ) : (
        <div className={emision.tablaContenedor}>
          <table className={`${emision.tabla} ${estilos.tablaDelLibro}`}>
            <thead>
              <tr>
                <th scope="col">Anotar</th>
                <th scope="col">Fila</th>
                <th scope="col">Proveedor</th>
                <th scope="col">RNC o cédula</th>
                <th scope="col">NCF</th>
                <th scope="col">Fecha</th>
                <th scope="col" className={emision.derecha}>
                  Monto
                </th>
                <th scope="col" className={emision.derecha}>
                  ITBIS
                </th>
                <th scope="col" className={emision.derecha}>
                  Propina
                </th>
                <th scope="col">Tipo</th>
                <th scope="col">Clase</th>
                <th scope="col">Forma de pago</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {actual.filas.map((fila, indice) => (
                <FilaDelLibro
                  key={fila.fila}
                  fila={fila}
                  eleccion={elecciones[fila.fila] ?? {}}
                  estado={estados[indice]}
                  formaGeneral={formaGeneral}
                  elegir={(cambios) => elegir(fila.fila, cambios)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className={estilos.botones}>
        <button
          type="button"
          onClick={() => startTransition(() => guardar(compras))}
          disabled={compras.length === 0 || guardando}
          className={emision.boton}
        >
          {guardando
            ? 'Guardando…'
            : compras.length === 1
              ? 'Guardar 1 compra'
              : `Guardar ${compras.length} compras`}
        </button>
        <span className={emision.ayuda}>
          {cuantas('lista')} listas · {cuantas('revisaRNC', 'faltaForma')} por revisar ·{' '}
          {cuantas('noVa')} no van
        </span>
      </p>
      <div aria-live="polite">
        {guardado?.guardado === false && (
          <div className={emision.fallido}>
            <h3>No se guardó nada</h3>
            <ul>
              {guardado.errores.map((error, indice) => (
                <li key={indice}>{error}</li>
              ))}
            </ul>
            <p>Vuelve a intentarlo.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function FilaDelLibro({
  fila,
  eleccion,
  estado,
  formaGeneral,
  elegir,
}: {
  fila: FilaDeGastos;
  eleccion: EleccionDeFila;
  estado: EstadoDeFila;
  formaGeneral?: FormaPago;
  elegir: (cambios: EleccionDeFila) => void;
}) {
  const cual = `la fila ${fila.fila}`;
  const lista = estado.estado === 'lista';
  const cedula = fila.revisarRNC?.cedula;
  const rnc = eleccion.rnc === 'cedula' && cedula !== undefined ? cedula : fila.rnc;
  return (
    <tr className={fila.noVa === undefined ? emision.fila : `${emision.fila} ${estilos.filaQueNoVa}`}>
      <td>
        <input
          type="checkbox"
          checked={lista && eleccion.anotar !== false}
          disabled={!lista}
          onChange={(evento) => elegir({ anotar: evento.target.checked })}
          aria-label={`Anotar ${cual}`}
        />
      </td>
      <td className={emision.numeroLinea}>{fila.fila}</td>
      <td>{fila.proveedor}</td>
      <td className={emision.cifra}>{rnc}</td>
      <td className={emision.cifra}>{fila.ncf}</td>
      <td className={emision.cifra}>{fila.fecha === '' ? '—' : fechaLegible(fila.fecha)}</td>
      <td className={emision.monto}>{monto(fila.monto)}</td>
      <td className={emision.monto}>{monto(fila.itbis)}</td>
      <td className={emision.monto}>{fila.propina === '0.00' ? '—' : monto(fila.propina)}</td>
      {fila.noVa === undefined ? (
        <>
          <td>
            <select
              value={eleccion.tipo ?? fila.tipo}
              onChange={(evento) => elegir({ tipo: evento.target.value as TipoBienesServicios })}
              aria-label={`Tipo de bienes y servicios de ${cual}`}
              className={emision.entrada}
            >
              {Object.entries(TIPOS_DE_BIENES_Y_SERVICIOS).map(([codigo, nombre]) => (
                <option key={codigo} value={codigo}>
                  {codigo} · {nombre}
                </option>
              ))}
            </select>
          </td>
          <td>
            <select
              value={eleccion.clase ?? fila.clase}
              onChange={(evento) => elegir({ clase: evento.target.value as Clase })}
              aria-label={`Bienes o servicios en ${cual}`}
              className={emision.entrada}
            >
              <option value="servicios">Servicios</option>
              <option value="bienes">Bienes</option>
            </select>
          </td>
          <td>
            <select
              value={eleccion.forma ?? fila.forma ?? ''}
              onChange={(evento) => elegir({ forma: formaElegida(evento.target.value) })}
              aria-label={`Forma de pago de ${cual}`}
              className={emision.entrada}
            >
              {fila.forma === undefined && (
                <option value="">
                  {formaGeneral === undefined ? 'Sin elegir' : `${FORMAS_DE_PAGO[formaGeneral]} (la de las demás)`}
                </option>
              )}
              {Object.entries(FORMAS_DE_PAGO).map(([codigo, nombre]) => (
                <option key={codigo} value={codigo}>
                  {nombre}
                </option>
              ))}
            </select>
          </td>
        </>
      ) : (
        <td colSpan={3} />
      )}
      <td>
        <EstadoDeLaFila estado={estado} elegir={elegir} />
      </td>
    </tr>
  );
}

function EstadoDeLaFila({
  estado,
  elegir,
}: {
  estado: EstadoDeFila;
  elegir: (cambios: EleccionDeFila) => void;
}) {
  if (estado.estado === 'lista') return <span className={estilos.lista}>Lista</span>;
  if (estado.estado === 'faltaForma') {
    return <span className={estilos.pendiente}>Falta la forma de pago</span>;
  }
  if (estado.estado === 'noVa') {
    return <span className={estilos.noVa}>No va: {estado.motivos.join(' ')}</span>;
  }
  return (
    <span className={estilos.pendiente}>
      {estado.cedula === undefined
        ? 'Revisa el RNC: el dígito verificador no cuadra.'
        : `Revisa el RNC: ¿es la cédula ${estado.cedula}?`}
      <span className={estilos.acciones}>
        {estado.cedula !== undefined && (
          <button type="button" onClick={() => elegir({ rnc: 'cedula' })}>
            Usar la cédula
          </button>
        )}
        <button type="button" onClick={() => elegir({ rnc: 'numero' })}>
          Dejar el número
        </button>
      </span>
    </span>
  );
}

function Resumen({ guardado }: { guardado: Guardado }) {
  return (
    <div aria-live="polite" className={estilos.vistaPrevia}>
      <p className={estilos.aviso}>
        {guardado.guardadas === 1
          ? 'Se guardó 1 compra.'
          : `Se guardaron ${guardado.guardadas} compras.`}{' '}
        Las guardadas ya están en la lista del mes.
      </p>
      {guardado.noGuardadas.length > 0 && (
        <div className={emision.fallido}>
          <h3>No se guardaron</h3>
          <ul>
            {guardado.noGuardadas.map((motivo, indice) => (
              <li key={indice}>{motivo}</li>
            ))}
          </ul>
          <p>Corrígelas en el libro y vuelve a leerlo, o anótalas a mano.</p>
        </div>
      )}
    </div>
  );
}

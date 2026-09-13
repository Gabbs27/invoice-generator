'use client';

import Link from 'next/link';
import { startTransition, useActionState, useState, type ReactNode } from 'react';
import type { CampoPorCompletar } from '@/lib/compras/desdeECF';
import {
  esPeriodo,
  haciaElNavegador,
  nombreDelPeriodo,
  periodoAnterior,
  periodoSiguiente,
} from '@/lib/compras/fechas';
import { aCentavos, aMonto } from '@/lib/compras/montos';
import {
  claveDeCompra,
  FORMAS_DE_PAGO,
  TIPOS_DE_BIENES_Y_SERVICIOS,
  TIPOS_DE_RETENCION_ISR,
  type Compra,
} from '@/lib/compras/tipos';
import { conMiles } from '@/lib/formato';
import emision from '../emision.module.css';
import { Campo, Titulo } from '../partes';
import {
  borrarCompra,
  generar606,
  guardarCompra,
  importarXML,
  type ResultadoDeGuardar,
  type ResultadoDeImportar,
  type ResultadoDel606,
} from './acciones';
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

// Lo que el formulario muestra: una compra nueva, una por corregir o una importada de un XML.
interface Edicion {
  clave?: string;
  inicial: Partial<Compra>;
  xml?: string;
  porCompletar?: CampoPorCompletar[];
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
  // Cada formulario que se abre se monta de nuevo, con sus valores iniciales.
  const [formularios, setFormularios] = useState(0);
  const [edicion, setEdicion] = useState<Edicion>({ inicial: {} });
  const [aviso, setAviso] = useState<string | null>(null);

  const abrir = (nueva: Edicion, mensaje: string | null) => {
    setEdicion(nueva);
    setAviso(mensaje);
    setFormularios((cuenta) => cuenta + 1);
    document.getElementById('titulo-anotar')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className={estilos.compras}>
      <Periodo periodo={periodo} />
      <section className={emision.seccion} aria-labelledby="titulo-anotar">
        <Titulo
          id="titulo-anotar"
          letra="A"
          nota={
            edicion.clave
              ? `Corrigiendo ${edicion.inicial.NCF} de ${edicion.inicial.RNCCedula}.`
              : undefined
          }
        >
          {edicion.clave ? 'Corregir una compra' : 'Anotar una compra'}
        </Titulo>
        {aviso && (
          <p className={estilos.aviso} aria-live="polite">
            {aviso}
          </p>
        )}
        {edicion.clave === undefined && (
          <ImportarXML
            alImportar={({ borrador, porCompletar, xml }) =>
              abrir(
                { inicial: borrador, porCompletar, xml },
                'Revisa la compra, completa lo marcado y guárdala. El XML se guarda con ella.'
              )
            }
          />
        )}
        <FormularioDeCompra
          key={formularios}
          {...edicion}
          alEnviar={() => setAviso(null)}
          alGuardar={(clave) => abrir({ inicial: {} }, `Guardada: ${clave.replace('_', ', ')}.`)}
          alCancelar={edicion.clave || edicion.xml ? () => abrir({ inicial: {} }, null) : undefined}
        />
      </section>
      <section className={emision.seccion} aria-labelledby="titulo-lista">
        <Titulo id="titulo-lista" letra="B">
          Compras de {nombreDelPeriodo(periodo)}
        </Titulo>
        <Lista
          periodo={periodo}
          lineas={lineas}
          acciones={(compra) => (
            <AccionesDeCompra
              compra={compra}
              alCorregir={() => {
                const clave = claveDeCompra(compra);
                abrir({ clave, inicial: completas[clave] ?? compra }, null);
              }}
            />
          )}
        />
      </section>
      <Bajar606 periodo={periodo} hayCompras={lineas.length > 0} />
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

function AccionesDeCompra({ compra, alCorregir }: { compra: Compra; alCorregir: () => void }) {
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const borrar = async () => {
    if (!window.confirm(`¿Borrar ${compra.NCF} de ${compra.RNCCedula}? No se puede deshacer.`)) {
      return;
    }
    setBorrando(true);
    const resultado = await borrarCompra(claveDeCompra(compra));
    setBorrando(false);
    if (!resultado.borrado) setError(resultado.errores.join(' '));
  };
  return (
    <>
      <button type="button" onClick={alCorregir}>
        Corregir
      </button>
      <button type="button" onClick={borrar} disabled={borrando}>
        {borrando ? 'Borrando…' : 'Borrar'}
      </button>
      {error && (
        <span role="alert" className={estilos.error}>
          {error}
        </span>
      )}
    </>
  );
}

function ImportarXML({
  alImportar,
}: {
  alImportar: (resultado: Extract<ResultadoDeImportar, { importado: true }>) => void;
}) {
  const [resultado, accion, importando] = useActionState<ResultadoDeImportar | null, FormData>(
    async (_anterior, datos) => {
      const nuevo = await importarXML(datos);
      if (nuevo.importado) alImportar(nuevo);
      return nuevo;
    },
    null
  );
  return (
    <form
      onSubmit={(evento) => {
        evento.preventDefault();
        const datos = new FormData(evento.currentTarget);
        startTransition(() => accion(datos));
      }}
      className={estilos.importar}
    >
      <label htmlFor="xml-ecf" className={emision.etiqueta}>
        XML de un e-CF recibido (31, 33 o 34)
      </label>
      <input id="xml-ecf" type="file" name="xml" accept=".xml,text/xml,application/xml" required />
      <button type="submit" disabled={importando} className={estilos.secundario}>
        {importando ? 'Revisando…' : 'Llenar desde el XML'}
      </button>
      <div aria-live="polite" className={estilos.resultadoDeImportar}>
        {resultado?.importado === false && (
          <div className={emision.fallido}>
            <h3>No se pudo importar</h3>
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
  );
}

const MONTO = '\\d{1,9}(\\.\\d{1,2})?';

type ValoresDelFormulario = Partial<Record<keyof Compra, string>>;

const MAS_CAMPOS = [
  ['ITBISRetenido', 'ITBIS retenido', 'Casilla 12', 'Pide la fecha de pago.'],
  [
    'ITBISProporcionalidad',
    'ITBIS sujeto a proporcionalidad',
    'Casilla 13',
    'Artículo 349 del Código Tributario.',
  ],
  ['ITBISCosto', 'ITBIS llevado al costo', 'Casilla 14', 'No puede pasar del ITBIS facturado.'],
  [
    'MontoRetencionRenta',
    'Retención de ISR',
    'Casilla 18',
    'Pide la fecha de pago y el tipo de retención.',
  ],
  ['ImpuestoSelectivo', 'Impuesto selectivo al consumo', 'Casilla 20', undefined],
  ['OtrosImpuestos', 'Otros impuestos o tasas', 'Casilla 21', undefined],
  ['PropinaLegal', 'Propina legal', 'Casilla 22', undefined],
] as const;

function FormularioDeCompra({
  clave,
  inicial,
  xml,
  porCompletar = [],
  alEnviar,
  alGuardar,
  alCancelar,
}: Edicion & {
  alEnviar: () => void;
  alGuardar: (clave: string) => void;
  alCancelar?: () => void;
}) {
  const valores: ValoresDelFormulario = {
    ...inicial,
    FechaComprobante: inicial.FechaComprobante && haciaElNavegador(inicial.FechaComprobante),
    FechaPago: inicial.FechaPago && haciaElNavegador(inicial.FechaPago),
  };
  const [resultado, accion, guardando] = useActionState<ResultadoDeGuardar | null, FormData>(
    async (_anterior, datos) => {
      const nuevo = await guardarCompra(datos);
      if (nuevo.guardado) alGuardar(nuevo.clave);
      return nuevo;
    },
    null
  );
  const falta = (campo: CampoPorCompletar, ayuda: string) =>
    porCompletar.includes(campo) ? 'Complétalo: el XML no lo trae.' : ayuda;
  const llaveFija = clave !== undefined || xml !== undefined;
  const conMasCampos =
    MAS_CAMPOS.some(([campo]) => valores[campo]) || porCompletar.includes('TipoRetencionISR');
  const entrada = emision.entrada;
  const cifra = `${emision.entrada} ${emision.cifra}`;
  const monto = `${cifra} ${emision.derecha}`;

  return (
    <form
      // Con <form action>, React reinicia el formulario al terminar la acción (ver
      // app/emision.tsx).
      onSubmit={(evento) => {
        evento.preventDefault();
        // El aviso de la compra anterior no se queda junto al resultado de este envío.
        alEnviar();
        const datos = new FormData(evento.currentTarget);
        startTransition(() => accion(datos));
      }}
      className={emision.formulario}
    >
      <fieldset disabled={guardando} className={emision.contenido}>
        {clave && <input type="hidden" name="claveOriginal" value={clave} />}
        {xml && <input type="hidden" name="xml" value={xml} />}
        <div className={emision.campos}>
          <Campo
            id="rnc-proveedor"
            etiqueta="RNC o cédula del proveedor"
            codigo="Casilla 1"
            ayuda={
              llaveFija
                ? 'No se cambia: con otro proveedor, es otra compra.'
                : '9 u 11 dígitos. Los guiones se quitan al guardar.'
            }
          >
            <input
              id="rnc-proveedor"
              name="RNCCedula"
              defaultValue={valores.RNCCedula}
              readOnly={llaveFija}
              required
              inputMode="numeric"
              autoComplete="off"
              aria-describedby="rnc-proveedor-ayuda"
              className={cifra}
            />
          </Campo>
          <Campo
            id="ncf"
            etiqueta="NCF"
            codigo="Casilla 4"
            ayuda={
              llaveFija
                ? 'No se cambia: con otro NCF, es otra compra.'
                : 'Serie B de 11 caracteres o e-NCF de 13.'
            }
          >
            <input
              id="ncf"
              name="NCF"
              defaultValue={valores.NCF}
              readOnly={llaveFija}
              required
              maxLength={13}
              autoComplete="off"
              aria-describedby="ncf-ayuda"
              className={cifra}
            />
          </Campo>
          <Campo
            id="ncf-modificado"
            etiqueta="NCF modificado"
            codigo="Casilla 5"
            ayuda="Solo en notas de débito y de crédito."
          >
            <input
              id="ncf-modificado"
              name="NCFModificado"
              defaultValue={valores.NCFModificado}
              maxLength={13}
              autoComplete="off"
              aria-describedby="ncf-modificado-ayuda"
              className={cifra}
            />
          </Campo>
          <Campo id="fecha-comprobante" etiqueta="Fecha del comprobante" codigo="Casilla 6">
            <input
              id="fecha-comprobante"
              type="date"
              name="FechaComprobante"
              defaultValue={valores.FechaComprobante}
              required
              className={entrada}
            />
          </Campo>
          <Campo
            id="fecha-pago"
            etiqueta="Fecha de pago"
            codigo="Casilla 7"
            ayuda={falta('FechaPago', 'Si ya se pagó. Con retenciones es obligatoria.')}
          >
            <input
              id="fecha-pago"
              type="date"
              name="FechaPago"
              defaultValue={valores.FechaPago}
              aria-describedby="fecha-pago-ayuda"
              className={entrada}
            />
          </Campo>
          <Campo
            id="tipo-bienes"
            etiqueta="Tipo de bienes y servicios"
            codigo="Casilla 3"
            ayuda={falta('TipoBienesServicios', 'Cómo se usa lo comprado.')}
          >
            <select
              id="tipo-bienes"
              name="TipoBienesServicios"
              defaultValue={valores.TipoBienesServicios ?? ''}
              required
              aria-describedby="tipo-bienes-ayuda"
              className={entrada}
            >
              <option value="" disabled>
                Elige uno
              </option>
              {Object.entries(TIPOS_DE_BIENES_Y_SERVICIOS).map(([codigo, nombre]) => (
                <option key={codigo} value={codigo}>
                  {codigo} · {nombre}
                </option>
              ))}
            </select>
          </Campo>
          <Campo
            id="forma-pago"
            etiqueta="Forma de pago"
            codigo="Casilla 23"
            ayuda={falta('FormaPago', 'Mixto si se pagó de varias formas.')}
          >
            <select
              id="forma-pago"
              name="FormaPago"
              defaultValue={valores.FormaPago ?? ''}
              required
              aria-describedby="forma-pago-ayuda"
              className={entrada}
            >
              <option value="" disabled>
                Elige una
              </option>
              {Object.entries(FORMAS_DE_PAGO).map(([codigo, nombre]) => (
                <option key={codigo} value={codigo}>
                  {nombre}
                </option>
              ))}
            </select>
          </Campo>
          <Campo
            id="monto-servicios"
            etiqueta="Monto en servicios"
            codigo="Casilla 8"
            ayuda="Sin impuestos."
          >
            <input
              id="monto-servicios"
              name="MontoServicios"
              defaultValue={valores.MontoServicios}
              inputMode="decimal"
              pattern={MONTO}
              placeholder="0.00"
              aria-describedby="monto-servicios-ayuda"
              className={monto}
            />
          </Campo>
          <Campo
            id="monto-bienes"
            etiqueta="Monto en bienes"
            codigo="Casilla 9"
            ayuda="Sin impuestos."
          >
            <input
              id="monto-bienes"
              name="MontoBienes"
              defaultValue={valores.MontoBienes}
              inputMode="decimal"
              pattern={MONTO}
              placeholder="0.00"
              aria-describedby="monto-bienes-ayuda"
              className={monto}
            />
          </Campo>
          <Campo
            id="itbis-facturado"
            etiqueta="ITBIS facturado"
            codigo="Casilla 11"
            ayuda="El ITBIS del comprobante."
          >
            <input
              id="itbis-facturado"
              name="ITBISFacturado"
              defaultValue={valores.ITBISFacturado}
              inputMode="decimal"
              pattern={MONTO}
              placeholder="0.00"
              aria-describedby="itbis-facturado-ayuda"
              className={monto}
            />
          </Campo>
        </div>
        <details className={estilos.masCampos} open={conMasCampos}>
          <summary>Retenciones, proporcionalidad y otros impuestos</summary>
          <div className={emision.campos}>
            {MAS_CAMPOS.map(([campo, etiqueta, codigo, ayuda]) => {
              const id = `campo-${campo}`;
              return (
                <Campo key={campo} id={id} etiqueta={etiqueta} codigo={codigo} ayuda={ayuda}>
                  <input
                    id={id}
                    name={campo}
                    defaultValue={valores[campo]}
                    inputMode="decimal"
                    pattern={MONTO}
                    placeholder="—"
                    aria-describedby={ayuda ? `${id}-ayuda` : undefined}
                    className={monto}
                  />
                </Campo>
              );
            })}
            <Campo
              id="tipo-retencion"
              etiqueta="Tipo de retención en ISR"
              codigo="Casilla 17"
              ayuda={falta('TipoRetencionISR', 'Solo con retención de ISR.')}
            >
              <select
                id="tipo-retencion"
                name="TipoRetencionISR"
                defaultValue={valores.TipoRetencionISR ?? ''}
                aria-describedby="tipo-retencion-ayuda"
                className={entrada}
              >
                <option value="">Sin retención</option>
                {Object.entries(TIPOS_DE_RETENCION_ISR).map(([codigo, nombre]) => (
                  <option key={codigo} value={codigo}>
                    {codigo} · {nombre}
                  </option>
                ))}
              </select>
            </Campo>
          </div>
        </details>
        <p className={estilos.botones}>
          <button type="submit" className={emision.boton}>
            {guardando ? 'Guardando…' : clave ? 'Guardar la corrección' : 'Guardar la compra'}
          </button>
          {alCancelar && (
            <button type="button" onClick={alCancelar} className={estilos.secundario}>
              Cancelar
            </button>
          )}
        </p>
        <div aria-live="polite">
          {resultado?.guardado === false && (
            <div className={emision.fallido}>
              <h3>No se guardó</h3>
              <ul>
                {resultado.errores.map((error, indice) => (
                  <li key={indice}>{error}</li>
                ))}
              </ul>
              <p>Corrige eso y vuelve a guardar.</p>
            </div>
          )}
        </div>
      </fieldset>
    </form>
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
            activo, que el NCF esté autorizado, que el e-CF haya sido aceptado) aparece cuando
            procesa el envío.
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

'use client';

import { useActionState, useState, type ReactNode } from 'react';
import {
  calcularMontoItem,
  calcularTotales,
  TASAS_ITBIS,
  type Linea,
  type Totales,
} from '@/lib/ecf/calculo';
import { nombreTipo } from '@/lib/ecf/tipos';
import type { ResultadoDeEmision } from '@/lib/emitir';
import type { Modo } from '@/lib/storage';
import { emitir } from './acciones';
import estilos from './emision.module.css';

// Códigos y nombres del Formato e-CF v1.0: TipoIngresos (pág. 7), TipoPago (pág. 9),
// IndicadorFacturacion (pág. 37) e IndicadorBienoServicio (pág. 38).
const TIPOS_DE_INGRESO = [
  ['01', 'Ingresos por operaciones (no financieros)'],
  ['02', 'Ingresos financieros'],
  ['03', 'Ingresos extraordinarios'],
  ['04', 'Ingresos por arrendamientos'],
  ['05', 'Ingresos por venta de activo depreciable'],
  ['06', 'Otros ingresos'],
] as const;

const TIPOS_DE_PAGO = [
  ['1', 'Contado'],
  ['2', 'Crédito'],
  ['3', 'Gratuito'],
] as const;

const INDICADORES_DE_FACTURACION = [
  ['1', `ITBIS ${TASAS_ITBIS.ITBIS1} %`],
  ['2', `ITBIS ${TASAS_ITBIS.ITBIS2} %`],
  ['3', `ITBIS ${TASAS_ITBIS.ITBIS3} %`],
  ['4', 'Exento'],
] as const;

const HASTA_2_DECIMALES = '\\d{1,16}(\\.\\d{1,2})?';
const HASTA_4_DECIMALES = '\\d{1,16}(\\.\\d{1,4})?';

interface LineaDelFormulario {
  clave: number;
  NombreItem: string;
  IndicadorBienoServicio: string;
  CantidadItem: string;
  PrecioUnitarioItem: string;
  IndicadorFacturacion: string;
  DescuentoMonto: string;
}

const lineaNueva = (clave: number): LineaDelFormulario => ({
  clave,
  NombreItem: '',
  IndicadorBienoServicio: '1',
  CantidadItem: '1',
  PrecioUnitarioItem: '',
  IndicadorFacturacion: '1',
  DescuentoMonto: '',
});

// Para los montos que se ven mientras se escribe. Al emitir, el servidor recalcula todo.
function aLinea(linea: LineaDelFormulario): Linea {
  const descuento = linea.DescuentoMonto.trim();
  return {
    CantidadItem: linea.CantidadItem.trim(),
    PrecioUnitarioItem: linea.PrecioUnitarioItem.trim(),
    IndicadorFacturacion: Number(linea.IndicadorFacturacion) as Linea['IndicadorFacturacion'],
    ...(descuento === '' ? {} : { DescuentoMonto: descuento }),
  };
}

function siSePuede<T>(calcular: () => T): T | null {
  try {
    return calcular();
  } catch {
    return null;
  }
}

// '1234567.50' → '1,234,567.50', sin pasar por punto flotante.
function conMiles(monto: string): string {
  const [enteros, decimales] = monto.split('.');
  return `${enteros.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${decimales}`;
}

export function Emision({ modo, habilitado }: { modo: Modo; habilitado: boolean }) {
  // Cada emisión monta un formulario nuevo, vacío: lo emitido no queda listo para mandarse
  // otra vez. Si no se emitió, lo escrito se queda para corregirlo.
  const [emisiones, setEmisiones] = useState(0);
  const [resultado, accion, emitiendo] = useActionState<ResultadoDeEmision | null, FormData>(
    async (_anterior, datos) => {
      const nuevo = await emitir(datos);
      if (nuevo.emitido) setEmisiones((cuenta) => cuenta + 1);
      return nuevo;
    },
    null
  );

  return (
    <Formulario key={emisiones} accion={accion} emitiendo={emitiendo} habilitado={habilitado}>
      <Resultado resultado={resultado} modo={modo} />
    </Formulario>
  );
}

function Formulario({
  accion,
  emitiendo,
  habilitado,
  children,
}: {
  accion: (datos: FormData) => void;
  emitiendo: boolean;
  habilitado: boolean;
  children: ReactNode;
}) {
  const [tipo, setTipo] = useState<'31' | '32'>('31');
  const [tipoIngresos, setTipoIngresos] = useState('01');
  const [tipoPago, setTipoPago] = useState('1');
  const [incluyeITBIS, setIncluyeITBIS] = useState(false);
  const [rnc, setRnc] = useState('');
  const [razonSocial, setRazonSocial] = useState('');
  const [lineas, setLineas] = useState([lineaNueva(1)]);

  const cambiarLinea = (clave: number, cambios: Partial<LineaDelFormulario>) =>
    setLineas((actuales) =>
      actuales.map((linea) => (linea.clave === clave ? { ...linea, ...cambios } : linea))
    );
  const agregarLinea = () =>
    setLineas((actuales) => [
      ...actuales,
      lineaNueva(Math.max(...actuales.map((linea) => linea.clave)) + 1),
    ]);
  const quitarLinea = (clave: number) =>
    setLineas((actuales) => actuales.filter((linea) => linea.clave !== clave));

  const totales = siSePuede(() =>
    calcularTotales(lineas.map(aLinea), { IndicadorMontoGravado: incluyeITBIS ? 1 : 0 })
  );

  return (
    <form action={accion} className={estilos.formulario}>
      <fieldset disabled={!habilitado || emitiendo} className={estilos.contenido}>
        <section className={estilos.seccion} aria-labelledby="titulo-encabezado">
          <Titulo id="titulo-encabezado" letra="A">
            Encabezado
          </Titulo>
          <fieldset className={estilos.tipos}>
            <legend className={estilos.oculto}>Tipo de comprobante</legend>
            {(['31', '32'] as const).map((codigo) => (
              <label key={codigo} className={estilos.tipo}>
                <input
                  type="radio"
                  name="tipo"
                  value={codigo}
                  checked={tipo === codigo}
                  onChange={() => setTipo(codigo)}
                />
                <span className={estilos.tipoNumero} aria-hidden="true">
                  {codigo}
                </span>
                <span className={estilos.tipoNombre}>{nombreTipo(codigo)}</span>
              </label>
            ))}
          </fieldset>
          <div className={estilos.campos}>
            <Campo id="tipo-ingresos" etiqueta="Tipo de ingreso" xsd="TipoIngresos">
              <select
                id="tipo-ingresos"
                name="TipoIngresos"
                value={tipoIngresos}
                onChange={(evento) => setTipoIngresos(evento.target.value)}
                className={estilos.entrada}
              >
                {TIPOS_DE_INGRESO.map(([codigo, nombre]) => (
                  <option key={codigo} value={codigo}>
                    {codigo} · {nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo
              id="tipo-pago"
              etiqueta="Tipo de pago"
              xsd="TipoPago"
              ayuda={
                tipoPago === '3'
                  ? 'Una factura gratuita no es válida para crédito fiscal.'
                  : undefined
              }
            >
              <select
                id="tipo-pago"
                name="TipoPago"
                value={tipoPago}
                onChange={(evento) => setTipoPago(evento.target.value)}
                aria-describedby={tipoPago === '3' ? 'tipo-pago-ayuda' : undefined}
                className={estilos.entrada}
              >
                {TIPOS_DE_PAGO.map(([codigo, nombre]) => (
                  <option key={codigo} value={codigo}>
                    {nombre}
                  </option>
                ))}
              </select>
            </Campo>
            {tipoPago === '2' && <FechaLimiteDePago />}
            <div className={estilos.campo}>
              <span className={estilos.etiqueta}>
                ITBIS
                <span className={estilos.xsd} aria-hidden="true">
                  IndicadorMontoGravado
                </span>
              </span>
              <label className={estilos.casilla}>
                <input
                  type="checkbox"
                  checked={incluyeITBIS}
                  onChange={(evento) => setIncluyeITBIS(evento.target.checked)}
                />
                Los precios ya incluyen el ITBIS
              </label>
              <input type="hidden" name="IndicadorMontoGravado" value={incluyeITBIS ? '1' : '0'} />
            </div>
          </div>
        </section>

        <section className={estilos.seccion} aria-labelledby="titulo-comprador">
          <Titulo
            id="titulo-comprador"
            letra="B"
            nota={
              tipo === '31'
                ? 'Obligatorio en la factura de crédito fiscal.'
                : 'Opcional en la factura de consumo por debajo de RD$250,000.00.'
            }
          >
            Comprador
          </Titulo>
          <div className={estilos.campos}>
            <Campo
              id="rnc-comprador"
              etiqueta="RNC o cédula"
              xsd="RNCComprador"
              ayuda="9 u 11 dígitos. Los guiones se quitan al emitir."
            >
              <input
                id="rnc-comprador"
                name="RNCComprador"
                value={rnc}
                onChange={(evento) => setRnc(evento.target.value)}
                required={tipo === '31'}
                inputMode="numeric"
                autoComplete="off"
                aria-describedby="rnc-comprador-ayuda"
                className={`${estilos.entrada} ${estilos.cifra}`}
              />
            </Campo>
            <Campo id="razon-social" etiqueta="Razón social" xsd="RazonSocialComprador">
              <input
                id="razon-social"
                name="RazonSocialComprador"
                value={razonSocial}
                onChange={(evento) => setRazonSocial(evento.target.value)}
                required={tipo === '31'}
                maxLength={150}
                autoComplete="off"
                className={estilos.entrada}
              />
            </Campo>
          </div>
        </section>

        <section className={estilos.seccion} aria-labelledby="titulo-detalle">
          <Titulo id="titulo-detalle" letra="C">
            Detalle de bienes o servicios
          </Titulo>
          <div className={estilos.tablaContenedor}>
            <table className={estilos.tabla}>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col" className={estilos.columnaDescripcion}>
                    Descripción
                  </th>
                  <th scope="col" className={estilos.columnaMedia}>
                    Bien o servicio
                  </th>
                  <th scope="col" className={`${estilos.columnaCorta} ${estilos.derecha}`}>
                    Cantidad
                  </th>
                  <th scope="col" className={`${estilos.columnaMedia} ${estilos.derecha}`}>
                    Precio unitario
                  </th>
                  <th scope="col" className={estilos.columnaMedia}>
                    ITBIS
                  </th>
                  <th scope="col" className={`${estilos.columnaCorta} ${estilos.derecha}`}>
                    Descuento
                  </th>
                  <th scope="col" className={`${estilos.columnaMedia} ${estilos.derecha}`}>
                    Monto
                  </th>
                  <th scope="col">
                    <span className={estilos.oculto}>Quitar</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((linea, indice) => {
                  const numero = indice + 1;
                  const monto = siSePuede(() => calcularMontoItem(aLinea(linea)));
                  return (
                    <tr key={linea.clave} className={estilos.fila}>
                      <td className={estilos.numeroLinea}>{numero}</td>
                      <td>
                        <input
                          name="NombreItem"
                          value={linea.NombreItem}
                          onChange={(evento) =>
                            cambiarLinea(linea.clave, { NombreItem: evento.target.value })
                          }
                          required
                          maxLength={80}
                          autoComplete="off"
                          aria-label={`Descripción de la línea ${numero}`}
                          className={estilos.entrada}
                        />
                      </td>
                      <td>
                        <select
                          name="IndicadorBienoServicio"
                          value={linea.IndicadorBienoServicio}
                          onChange={(evento) =>
                            cambiarLinea(linea.clave, {
                              IndicadorBienoServicio: evento.target.value,
                            })
                          }
                          aria-label={`Bien o servicio de la línea ${numero}`}
                          className={estilos.entrada}
                        >
                          <option value="1">Bien</option>
                          <option value="2">Servicio</option>
                        </select>
                      </td>
                      <td>
                        <input
                          name="CantidadItem"
                          value={linea.CantidadItem}
                          onChange={(evento) =>
                            cambiarLinea(linea.clave, { CantidadItem: evento.target.value })
                          }
                          required
                          inputMode="decimal"
                          pattern={HASTA_2_DECIMALES}
                          title="Hasta 2 decimales, con punto."
                          aria-label={`Cantidad de la línea ${numero}`}
                          className={`${estilos.entrada} ${estilos.cifra} ${estilos.derecha}`}
                        />
                      </td>
                      <td>
                        <input
                          name="PrecioUnitarioItem"
                          value={linea.PrecioUnitarioItem}
                          onChange={(evento) =>
                            cambiarLinea(linea.clave, { PrecioUnitarioItem: evento.target.value })
                          }
                          required
                          inputMode="decimal"
                          pattern={HASTA_4_DECIMALES}
                          title="Hasta 4 decimales, con punto."
                          placeholder="0.00"
                          aria-label={`Precio unitario de la línea ${numero}`}
                          className={`${estilos.entrada} ${estilos.cifra} ${estilos.derecha}`}
                        />
                      </td>
                      <td>
                        <select
                          name="IndicadorFacturacion"
                          value={linea.IndicadorFacturacion}
                          onChange={(evento) =>
                            cambiarLinea(linea.clave, { IndicadorFacturacion: evento.target.value })
                          }
                          aria-label={`ITBIS de la línea ${numero}`}
                          className={estilos.entrada}
                        >
                          {INDICADORES_DE_FACTURACION.map(([codigo, nombre]) => (
                            <option key={codigo} value={codigo}>
                              {nombre}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          name="DescuentoMonto"
                          value={linea.DescuentoMonto}
                          onChange={(evento) =>
                            cambiarLinea(linea.clave, { DescuentoMonto: evento.target.value })
                          }
                          inputMode="decimal"
                          pattern={HASTA_2_DECIMALES}
                          title="Opcional. Hasta 2 decimales, con punto."
                          placeholder="—"
                          aria-label={`Descuento de la línea ${numero}`}
                          className={`${estilos.entrada} ${estilos.cifra} ${estilos.derecha}`}
                        />
                      </td>
                      <td className={estilos.monto}>{monto === null ? '—' : conMiles(monto)}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => quitarLinea(linea.clave)}
                          disabled={lineas.length === 1}
                          aria-label={`Quitar la línea ${numero}`}
                          className={estilos.quitar}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            onClick={agregarLinea}
            disabled={lineas.length >= 1000}
            className={estilos.agregar}
          >
            + Agregar línea
          </button>
        </section>

        <section className={`${estilos.seccion} ${estilos.cierre}`} aria-labelledby="titulo-emitir">
          <div>
            <Titulo id="titulo-emitir" letra="D">
              Firmar y emitir
            </Titulo>
            <p className={estilos.pasos}>
              Arma el XML, lo firma, lo valida contra el XSD de DGII y solo entonces lo guarda. Si
              algo falla, no se guarda nada y el número de secuencia sigue libre.
            </p>
            <button type="submit" className={estilos.boton}>
              {emitiendo ? 'Firmando y validando…' : 'Firmar y emitir'}
            </button>
            {children}
          </div>
          <ResumenDeTotales totales={totales} />
        </section>
      </fieldset>
    </form>
  );
}

function Titulo({
  id,
  letra,
  nota,
  children,
}: {
  id: string;
  letra: string;
  nota?: string;
  children: ReactNode;
}) {
  return (
    <div className={estilos.titulo}>
      <span className={estilos.letra} aria-hidden="true">
        {letra}
      </span>
      <h2 id={id} className={estilos.nombre}>
        {children}
      </h2>
      <span className={estilos.regla} aria-hidden="true" />
      {nota && <p className={estilos.nota}>{nota}</p>}
    </div>
  );
}

function Campo({
  id,
  etiqueta,
  xsd,
  ayuda,
  children,
}: {
  id: string;
  etiqueta: string;
  xsd: string;
  ayuda?: string;
  children: ReactNode;
}) {
  return (
    <div className={estilos.campo}>
      <label htmlFor={id} className={estilos.etiqueta}>
        {etiqueta}
        <span className={estilos.xsd} aria-hidden="true">
          {xsd}
        </span>
      </label>
      {children}
      {ayuda && (
        <p id={`${id}-ayuda`} className={estilos.ayuda}>
          {ayuda}
        </p>
      )}
    </div>
  );
}

// Formato e-CF, pág. 9: la venta a crédito lleva su fecha límite de pago. Si cambia el tipo
// de pago, el campo se va con lo que tenía.
function FechaLimiteDePago() {
  const [fecha, setFecha] = useState('');
  return (
    <Campo
      id="fecha-limite-pago"
      etiqueta="Fecha límite de pago"
      xsd="FechaLimitePago"
      ayuda="No puede ser anterior a la fecha de emisión."
    >
      <input
        id="fecha-limite-pago"
        type="date"
        name="FechaLimitePago"
        value={fecha}
        onChange={(evento) => setFecha(evento.target.value)}
        required
        aria-describedby="fecha-limite-pago-ayuda"
        className={estilos.entrada}
      />
    </Campo>
  );
}

function ResumenDeTotales({ totales }: { totales: Totales | null }) {
  if (totales === null) {
    return (
      <div className={estilos.totales}>
        <p className={estilos.ayuda}>
          El total aparece cuando cada línea tiene una cantidad y un precio válidos.
        </p>
      </div>
    );
  }
  const renglones = [
    ['Monto gravado', totales.MontoGravadoTotal],
    [`ITBIS ${totales.ITBIS1} %`, totales.TotalITBIS1],
    [`ITBIS ${totales.ITBIS2} %`, totales.TotalITBIS2],
    [`ITBIS ${totales.ITBIS3} %`, totales.TotalITBIS3],
    ['Monto exento', totales.MontoExento],
  ].filter((renglon): renglon is [string, string] => renglon[1] !== undefined);

  return (
    <dl className={estilos.totales}>
      {renglones.map(([concepto, monto]) => (
        <div key={concepto} className={estilos.renglon}>
          <dt>{concepto}</dt>
          <dd>{conMiles(monto)}</dd>
        </div>
      ))}
      <div className={`${estilos.renglon} ${estilos.total}`}>
        <dt>Total</dt>
        <dd>RD$ {conMiles(totales.MontoTotal)}</dd>
      </div>
    </dl>
  );
}

function Resultado({ resultado, modo }: { resultado: ResultadoDeEmision | null; modo: Modo }) {
  return (
    <div aria-live="polite" className={estilos.resultado}>
      {resultado?.emitido === true && (
        <article className={estilos.emitido}>
          <p className={estilos.rotulo}>Emitido</p>
          <p className={estilos.encf}>{resultado.eNCF}</p>
          <ul className={estilos.comprobaciones}>
            <li>
              <span className={estilos.visto} aria-hidden="true">
                ✓
              </span>
              Firmado con XMLDSig y RSA-SHA256
              {modo === 'demostracion' && ', con el certificado de demostración'}.
            </li>
            <li>
              <span className={estilos.visto} aria-hidden="true">
                ✓
              </span>
              Válido contra el XSD de DGII.
            </li>
            <li>
              <span className={estilos.visto} aria-hidden="true">
                ✓
              </span>
              {modo === 'local' ? (
                <span>
                  Guardado en <code>datos/facturas/{resultado.eNCF}.xml</code>.
                </span>
              ) : (
                'Guardado en memoria: se pierde cuando el servidor se reinicia.'
              )}
            </li>
            <li>
              <span className={estilos.guion} aria-hidden="true">
                —
              </span>
              No se envió a DGII: esta versión no transmite.
            </li>
          </ul>
          <details className={estilos.xml}>
            <summary>Ver el XML firmado</summary>
            <pre>{resultado.xml}</pre>
          </details>
        </article>
      )}
      {resultado?.emitido === false && (
        <div className={estilos.fallido}>
          <h3>No se emitió</h3>
          <ul>
            {resultado.errores.map((error, indice) => (
              <li key={indice}>{error}</li>
            ))}
          </ul>
          <p>No se guardó nada y el número de secuencia sigue libre.</p>
        </div>
      )}
    </div>
  );
}

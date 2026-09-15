import { revisarRNC } from './digitoVerificador';
import { fechaLegible, nombreDelMes, nombreDelPeriodo } from './fechas';
import { aCentavos, aMonto, esMonto } from './montos';
import { leerNCFDeCompra } from './ncf';
import {
  claveDeCompra,
  esCodigo,
  FORMAS_DE_PAGO,
  TIPOS_DE_BIENES_Y_SERVICIOS,
  type Compra,
  type FormaPago,
  type TipoBienesServicios,
} from './tipos';
import { validarCompra } from './validar';
import type { Celda, Fila, Hoja, Libro } from './xlsx';

// Del libro de gastos a compras del 606: lo que dice cada fila y lo que falta revisar. No lee
// archivos, así que también corre en la página, para la vista previa.

const CERO = BigInt(0);
const UNO = BigInt(1);
const CIEN = BigInt(100);

// Las etiquetas se comparan sin mayúsculas, tildes ni espacios: "Método de pago" es metododepago.
export const normalizar = (texto: string): string =>
  texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '');

// Un número como lo guarda Excel en el XML ('1234.5', '-12', '1.30000001E8') a centavos, con la
// mitad hacia arriba y sin pasar por punto flotante.
export function centavosDeExcel(valor: string): bigint | undefined {
  const partes = valor.trim().match(/^(-?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
  if (partes === null) return undefined;
  const [, signo, enteros, fraccion = '', exponente = '0'] = partes;
  const digitos = enteros + fraccion;
  if (digitos === '') return undefined;
  // Dónde queda el punto después de multiplicar por 100.
  const punto = enteros.length + Number(exponente) + 2;
  let centavos: bigint;
  let siguiente: number;
  if (punto <= 0) {
    centavos = CERO;
    siguiente = punto === 0 ? Number(digitos[0]) : 0;
  } else if (punto >= digitos.length) {
    centavos = BigInt(digitos.padEnd(punto, '0'));
    siguiente = 0;
  } else {
    centavos = BigInt(digitos.slice(0, punto));
    siguiente = Number(digitos[punto]);
  }
  if (siguiente >= 5) centavos += UNO;
  return signo === '-' ? -centavos : centavos;
}

// Una celda de monto vacía vale cero. Un texto que no está en blanco no es un monto.
export function montoDeLaCelda(celda: Celda | undefined): bigint | undefined {
  if (celda === undefined) return CERO;
  if (celda.tipo === 'texto') return celda.valor.trim() === '' ? CERO : undefined;
  return centavosDeExcel(celda.valor);
}

// Los dígitos del RNC o la cédula. Como número llega sin guiones, pero en notación científica si
// es largo; como texto puede traer espacios y guiones. Lo que no es un entero va tal cual, y
// validarCompra dice por qué no sirve.
export function digitosDeExcel(celda: Celda | undefined): string {
  if (celda === undefined) return '';
  if (celda.tipo === 'texto') return celda.valor.replace(/[\s-]/g, '');
  const centavos = centavosDeExcel(celda.valor);
  return centavos !== undefined && centavos >= CERO && centavos % CIEN === CERO
    ? (centavos / CIEN).toString()
    : celda.valor;
}

// Excel cuenta los días desde el 30 de diciembre de 1899. Así cuadra desde marzo de 1900, después
// del 29 de febrero de 1900 que Excel cuenta y que no existió. Con fechas de 1904 cuenta desde el
// 1 de enero de 1904. La fracción es la hora, que no cuenta.
const EPOCA_1900 = Date.UTC(1899, 11, 30);
const EPOCA_1904 = Date.UTC(1904, 0, 1);
const UN_DIA = 86_400_000;

export function fechaDeExcel(celda: Celda | undefined, fechas1904: boolean): string | undefined {
  if (celda?.tipo !== 'numero') return undefined;
  const dias = Number(celda.valor);
  if (!Number.isFinite(dias) || dias < 1) return undefined;
  const fecha = new Date((fechas1904 ? EPOCA_1904 : EPOCA_1900) + Math.floor(dias) * UN_DIA);
  const dos = (numero: number) => String(numero).padStart(2, '0');
  return `${fecha.getUTCFullYear()}${dos(fecha.getUTCMonth() + 1)}${dos(fecha.getUTCDate())}`;
}

// Por palabras y en este orden: "Tarjeta de crédito" y "Notas de crédito" también dicen crédito.
const FORMAS_POR_PALABRA: [string, FormaPago][] = [
  ['nota', '6'],
  ['tarjeta', '3'],
  ['mixto', '7'],
  ['permuta', '5'],
  ['efectivo', '1'],
  ['cheque', '2'],
  ['transferencia', '2'],
  ['deposito', '2'],
  ['credito', '4'],
];

export function formaDePagoDelTexto(texto: string): FormaPago | undefined {
  const normalizado = normalizar(texto);
  return FORMAS_POR_PALABRA.find(([palabra]) => normalizado.includes(palabra))?.[1];
}

export type Clase = 'servicios' | 'bienes';

export interface Historia {
  tipo: TipoBienesServicios;
  clase: Clase;
  forma: FormaPago;
}

const centavosDelMonto = (valor: string) => (esMonto(valor) ? aCentavos(valor, 'Monto') : CERO);

// La compra guardada más reciente de cada proveedor propone el tipo, la clase y la forma de pago de
// sus filas. La clase es la del monto mayor.
export function historialDeProveedores(compras: Compra[]): Record<string, Historia> {
  const recientes = new Map<string, Compra>();
  for (const compra of compras) {
    if (!esCodigo(TIPOS_DE_BIENES_Y_SERVICIOS, compra.TipoBienesServicios)) continue;
    if (!esCodigo(FORMAS_DE_PAGO, compra.FormaPago)) continue;
    const anterior = recientes.get(compra.RNCCedula);
    if (anterior === undefined || compra.FechaComprobante >= anterior.FechaComprobante) {
      recientes.set(compra.RNCCedula, compra);
    }
  }
  return Object.fromEntries(
    [...recientes].map(([rnc, compra]): [string, Historia] => [
      rnc,
      {
        tipo: compra.TipoBienesServicios,
        clase:
          centavosDelMonto(compra.MontoBienes) > centavosDelMonto(compra.MontoServicios)
            ? 'bienes'
            : 'servicios',
        forma: compra.FormaPago,
      },
    ])
  );
}

export interface FilaDeGastos {
  // La fila en Excel, para encontrarla en el libro.
  fila: number;
  // Solo para mostrar: el 606 no lleva el nombre del proveedor.
  proveedor: string;
  rnc: string;
  ncf: string;
  // AAAAMMDD, o '' si la celda no trae una fecha de Excel.
  fecha: string;
  // Montos del 606 como texto decimal, o '' si no se pueden leer. El monto va sin impuestos.
  monto: string;
  itbis: string;
  propina: string;
  // Lo que se propone. Quien importa lo puede cambiar.
  tipo: TipoBienesServicios;
  clase: Clase;
  // Del texto de la fila o del historial. Sin ninguno, la que se elija para toda la importación.
  forma?: FormaPago;
  // El dígito verificador no cuadra: la cédula que se propone, o nada si el número es dudoso.
  revisarRNC?: { cedula?: string };
  // Por qué la fila no va. Con esto no hay nada que elegir.
  noVa?: string;
}

export interface HojaDeGastos {
  nombre: string;
  // Sin encabezado, o sin una columna obligatoria, la hoja no trae filas y dice por qué.
  motivo?: string;
  filas: FilaDeGastos[];
}

export interface LecturaDeGastos {
  hojas: HojaDeGastos[];
  // La hoja del mes que se ve en Compras, buscada por su nombre; si no hay, la primera.
  propuesta: number;
}

export interface ContextoDeLectura {
  periodo: string;
  // Las claves (claveDeCompra) de las compras ya guardadas.
  anotadas: Set<string>;
  historial: Record<string, Historia>;
}

// Las etiquetas del encabezado, ya normalizadas. El libro de referencia dice ITBS.
const COLUMNAS = {
  proveedor: ['proveedor'],
  rnc: ['rnc'],
  ncf: ['ncf'],
  fecha: ['fecha'],
  itbis: ['itbs', 'itbis'],
  propina: ['10%ley'],
  total: ['montototal'],
  forma: ['metododepago'],
} as const;

type Columna = keyof typeof COLUMNAS;
type Columnas = Partial<Record<Columna, number>>;

const OBLIGATORIAS = {
  rnc: 'RNC',
  ncf: 'NCF',
  fecha: 'Fecha',
  itbis: 'ITBS',
  total: 'Monto total',
} as const;

function columnasDe(fila: Fila): Columnas {
  const columnas: Columnas = {};
  fila.celdas.forEach((celda, indice) => {
    if (celda?.tipo !== 'texto') return;
    const etiqueta = normalizar(celda.valor);
    for (const columna of Object.keys(COLUMNAS) as Columna[]) {
      const etiquetas: readonly string[] = COLUMNAS[columna];
      if (etiquetas.includes(etiqueta) && columnas[columna] === undefined) columnas[columna] = indice;
    }
  });
  return columnas;
}

const esEncabezado = (columnas: Columnas) => columnas.rnc !== undefined && columnas.ncf !== undefined;

const montoLegible = (centavos: bigint | undefined) =>
  centavos === undefined || centavos < CERO ? '' : aMonto(centavos);

interface DatosDeLaFila {
  numero: number;
  ncf: string;
  rnc: string;
  cedula?: string;
  fecha: string;
  monto?: bigint;
  itbis?: bigint;
  propina?: bigint;
}

// Por qué una fila no va en el 606, o undefined si va. Lleva la cuenta de las ya leídas del mes
// para ver las repetidas.
function porQueNoVa(
  datos: DatosDeLaFila,
  contexto: ContextoDeLectura,
  vistas: Map<string, number>
): string | undefined {
  const lectura = leerNCFDeCompra(datos.ncf);
  if (!lectura.valido) return lectura.motivo;
  if (datos.fecha === '') return 'La fecha no es una fecha de Excel.';
  if (datos.fecha.slice(0, 6) !== contexto.periodo) {
    return `Es del ${fechaLegible(datos.fecha)}, no de ${nombreDelPeriodo(contexto.periodo)}.`;
  }
  // Con el número tal como vino y con la cédula que se propone.
  const claves = [datos.rnc, datos.cedula ?? '']
    .filter((valor) => valor !== '')
    .map((RNCCedula) => claveDeCompra({ RNCCedula, NCF: datos.ncf }));
  if (claves.some((clave) => contexto.anotadas.has(clave))) return 'Ya está anotada.';
  const repetida = claves.map((clave) => vistas.get(clave)).find((fila) => fila !== undefined);
  if (repetida !== undefined) return `Repite la fila ${repetida}.`;
  for (const clave of claves) vistas.set(clave, datos.numero);
  if (datos.monto === undefined || datos.itbis === undefined || datos.propina === undefined) {
    return 'Monto total, ITBS o 10% ley no es un número.';
  }
  if (datos.itbis < CERO || datos.propina < CERO) return 'El ITBS o el 10% ley es negativo.';
  if (datos.monto <= CERO) {
    return 'El monto sin impuestos (Monto total menos ITBS y 10% ley) es cero o negativo.';
  }
  return undefined;
}

function leerFilaDeGastos(
  numero: number,
  celda: (columna: Columna) => Celda | undefined,
  ncf: string,
  fechas1904: boolean,
  contexto: ContextoDeLectura,
  vistas: Map<string, number>
): FilaDeGastos {
  const rnc = digitosDeExcel(celda('rnc'));
  const revision = revisarRNC(rnc);
  const cedula = revision.estado === 'cedula' ? revision.cedula : undefined;
  const historia =
    contexto.historial[rnc] ?? (cedula === undefined ? undefined : contexto.historial[cedula]);
  const fecha = fechaDeExcel(celda('fecha'), fechas1904) ?? '';
  const total = montoDeLaCelda(celda('total'));
  const itbis = montoDeLaCelda(celda('itbis'));
  const propina = montoDeLaCelda(celda('propina'));
  // El monto total del libro incluye el ITBIS y la propina, y el 606 los lleva aparte.
  const monto =
    total === undefined || itbis === undefined || propina === undefined
      ? undefined
      : total - itbis - propina;

  const leida: FilaDeGastos = {
    fila: numero,
    proveedor: (celda('proveedor')?.valor ?? '').trim(),
    rnc,
    ncf,
    fecha,
    monto: montoLegible(monto),
    itbis: montoLegible(itbis),
    propina: montoLegible(propina),
    tipo: historia?.tipo ?? '9',
    clase: historia?.clase ?? 'servicios',
  };
  const forma = formaDePagoDelTexto(celda('forma')?.valor ?? '') ?? historia?.forma;
  if (forma !== undefined) leida.forma = forma;
  if (revision.estado === 'cedula') leida.revisarRNC = { cedula: revision.cedula };
  if (revision.estado === 'dudoso') leida.revisarRNC = {};
  const noVa = porQueNoVa(
    { numero, ncf, rnc, cedula, fecha, monto, itbis, propina },
    contexto,
    vistas
  );
  if (noVa !== undefined) leida.noVa = noVa;
  return leida;
}

function leerHojaDeGastos(
  hoja: Hoja,
  fechas1904: boolean,
  contexto: ContextoDeLectura
): HojaDeGastos {
  const inicio = hoja.filas.findIndex((fila) => esEncabezado(columnasDe(fila)));
  if (inicio < 0) {
    return { nombre: hoja.nombre, motivo: 'No tiene una fila de encabezado con RNC y NCF.', filas: [] };
  }
  const columnas = columnasDe(hoja.filas[inicio]);
  const faltan = (Object.keys(OBLIGATORIAS) as (keyof typeof OBLIGATORIAS)[])
    .filter((columna) => columnas[columna] === undefined)
    .map((columna) => OBLIGATORIAS[columna]);
  if (faltan.length > 0) {
    const numero = hoja.filas[inicio].numero;
    return {
      nombre: hoja.nombre,
      motivo: `Al encabezado de la fila ${numero} le falta: ${faltan.join(', ')}.`,
      filas: [],
    };
  }

  const filas: FilaDeGastos[] = [];
  const vistas = new Map<string, number>();
  for (const fila of hoja.filas.slice(inicio + 1)) {
    // Un encabezado repetido empieza otra tabla: las compras terminan ahí.
    if (esEncabezado(columnasDe(fila))) break;
    const celda = (columna: Columna): Celda | undefined => {
      const indice = columnas[columna];
      return indice === undefined ? undefined : fila.celdas[indice];
    };
    // Sin NCF no es una compra: son los totales, la lista de métodos de pago o filas vacías.
    const ncf = (celda('ncf')?.valor ?? '').replace(/[\s-]/g, '').toUpperCase();
    if (ncf === '') continue;
    filas.push(leerFilaDeGastos(fila.numero, celda, ncf, fechas1904, contexto, vistas));
  }
  return { nombre: hoja.nombre, filas };
}

export function leerGastos(libro: Libro, contexto: ContextoDeLectura): LecturaDeGastos {
  const mes = nombreDelMes(contexto.periodo);
  const propuesta = libro.hojas.findIndex((hoja) => normalizar(hoja.nombre).includes(mes));
  return {
    hojas: libro.hojas.map((hoja) => leerHojaDeGastos(hoja, libro.fechas1904, contexto)),
    propuesta: Math.max(propuesta, 0),
  };
}

// Lo que quien importa cambia en una fila de la vista previa. Lo que no toca queda como lo propuso
// la lectura.
export interface EleccionDeFila {
  tipo?: TipoBienesServicios;
  clase?: Clase;
  forma?: FormaPago;
  // En "Revisa el RNC": la cédula que se propone o el número como vino.
  rnc?: 'cedula' | 'numero';
  // La casilla "Anotar", marcada mientras no se desmarque.
  anotar?: boolean;
}

export interface OpcionesDeEvaluacion {
  rncDelNegocio: string;
  // La forma de pago elegida para las filas que no traen una y cuyo proveedor no tiene historial.
  formaGeneral?: FormaPago;
}

export type EstadoDeFila =
  | { estado: 'lista'; compra: Compra }
  | { estado: 'revisaRNC'; cedula?: string }
  | { estado: 'faltaForma' }
  | { estado: 'noVa'; motivos: string[] };

// La compra que sale de una fila con lo elegido. La fecha de pago es la del comprobante, salvo en
// una compra a crédito, que todavía no se ha pagado.
export function compraDeLaFila(
  fila: FilaDeGastos,
  eleccion: EleccionDeFila,
  forma: FormaPago
): Compra {
  const cedula = fila.revisarRNC?.cedula;
  const clase = eleccion.clase ?? fila.clase;
  const compra: Compra = {
    RNCCedula: eleccion.rnc === 'cedula' && cedula !== undefined ? cedula : fila.rnc,
    TipoBienesServicios: eleccion.tipo ?? fila.tipo,
    NCF: fila.ncf,
    FechaComprobante: fila.fecha,
    MontoServicios: clase === 'servicios' ? fila.monto : '0.00',
    MontoBienes: clase === 'bienes' ? fila.monto : '0.00',
    ITBISFacturado: fila.itbis,
    FormaPago: forma,
  };
  if (forma !== '4') compra.FechaPago = fila.fecha;
  if (fila.propina !== '0.00') compra.PropinaLegal = fila.propina;
  return compra;
}

export function evaluarFila(
  fila: FilaDeGastos,
  eleccion: EleccionDeFila,
  opciones: OpcionesDeEvaluacion
): EstadoDeFila {
  if (fila.noVa !== undefined) return { estado: 'noVa', motivos: [fila.noVa] };
  if (fila.revisarRNC !== undefined && eleccion.rnc === undefined) {
    return fila.revisarRNC.cedula === undefined
      ? { estado: 'revisaRNC' }
      : { estado: 'revisaRNC', cedula: fila.revisarRNC.cedula };
  }
  const forma = eleccion.forma ?? fila.forma ?? opciones.formaGeneral;
  if (forma === undefined) return { estado: 'faltaForma' };
  const compra = compraDeLaFila(fila, eleccion, forma);
  const errores = validarCompra(compra, opciones.rncDelNegocio);
  return errores.length > 0 ? { estado: 'noVa', motivos: errores } : { estado: 'lista', compra };
}

// Lo que se guarda: las filas listas con la casilla "Anotar" marcada. Las elecciones van por el
// número de la fila en Excel.
export function comprasElegidas(
  filas: FilaDeGastos[],
  elecciones: Record<number, EleccionDeFila>,
  opciones: OpcionesDeEvaluacion
): Compra[] {
  return filas.flatMap((fila) => {
    const eleccion = elecciones[fila.fila] ?? {};
    const estado = evaluarFila(fila, eleccion, opciones);
    return estado.estado === 'lista' && eleccion.anotar !== false ? [estado.compra] : [];
  });
}

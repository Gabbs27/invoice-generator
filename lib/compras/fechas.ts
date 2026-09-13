// Instructivo del 606 (febrero de 2026): las fechas van AAAAMMDD y el periodo AAAAMM. El formato
// vigente rige desde el periodo mayo de 2018.
const PRIMER_PERIODO = '201805';

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

const armarPeriodo = (anio: number, mes: number) => `${anio}${String(mes).padStart(2, '0')}`;

function existe(anio: number, mes: number, dia: number): boolean {
  const calendario = new Date(Date.UTC(anio, mes - 1, dia));
  return (
    calendario.getUTCFullYear() === anio &&
    calendario.getUTCMonth() === mes - 1 &&
    calendario.getUTCDate() === dia
  );
}

export function esFecha(valor: string): boolean {
  const partes = typeof valor === 'string' ? valor.match(/^(\d{4})(\d{2})(\d{2})$/) : null;
  return partes !== null && existe(Number(partes[1]), Number(partes[2]), Number(partes[3]));
}

export function esPeriodo(valor: string): boolean {
  return typeof valor === 'string' && /^\d{4}(0[1-9]|1[0-2])$/.test(valor) && valor >= PRIMER_PERIODO;
}

function partesDelPeriodo(periodo: string): [number, number] {
  if (!esPeriodo(periodo)) {
    throw new Error(`Periodo inválido: ${periodo}. Formato AAAAMM, desde 201805.`);
  }
  return [Number(periodo.slice(0, 4)), Number(periodo.slice(4))];
}

export function ultimoDiaDelPeriodo(periodo: string): string {
  const [anio, mes] = partesDelPeriodo(periodo);
  // El día 0 del mes siguiente es el último de este.
  const dia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return `${periodo}${String(dia).padStart(2, '0')}`;
}

export function periodoAnterior(periodo: string): string {
  const [anio, mes] = partesDelPeriodo(periodo);
  return mes === 1 ? armarPeriodo(anio - 1, 12) : armarPeriodo(anio, mes - 1);
}

export function periodoSiguiente(periodo: string): string {
  const [anio, mes] = partesDelPeriodo(periodo);
  return mes === 12 ? armarPeriodo(anio + 1, 1) : armarPeriodo(anio, mes + 1);
}

export function nombreDelPeriodo(periodo: string): string {
  const [anio, mes] = partesDelPeriodo(periodo);
  return `${MESES[mes - 1]} de ${anio}`;
}

// El campo de fecha del navegador manda AAAA-MM-DD. Que la fecha exista lo valida validarCompra.
export function desdeElNavegador(valor: string): string {
  const partes = valor.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!partes) throw new Error(`Fecha inválida: ${valor}.`);
  return partes.slice(1).join('');
}

export const haciaElNavegador = (fecha: string): string =>
  `${fecha.slice(0, 4)}-${fecha.slice(4, 6)}-${fecha.slice(6, 8)}`;

// República Dominicana está en GMT-4 todo el año, como en fechaHoraRD de lib/emitir.ts.
export function periodoEnRD(instante: Date): string {
  const rd = new Date(instante.getTime() - 4 * 60 * 60 * 1000);
  return armarPeriodo(rd.getUTCFullYear(), rd.getUTCMonth() + 1);
}

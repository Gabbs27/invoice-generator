# Formato de Envío 606 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Record purchases, typed in or imported from a supplier's e-CF XML, and generate DGII's
monthly 606 file for the Oficina Virtual.

**Architecture:**
- **Engine:** a pure engine in `lib/compras/` covers amounts, dates, codes, validation, the month
  rule, the file writer and the e-CF importer.
- **Storage:** purchases go through the existing `Almacenamiento` interface, in `datos/compras/`
  locally and in memory on Vercel.
- **App:** Server Actions in `app/compras/acciones.ts` and a `/compras` page.
- **Design:** `docs/plans/2026-09-13-dgii-606-design.md`.

**Tech Stack:**
- Next.js 16 (App Router, Server Actions), React 19, Vitest 5.
- TypeScript with target ES2017: write `BigInt(0)`, never `0n`.
- `@xmldom/xmldom`, and `xmllint-wasm` through `lib/ecf/validar.ts`.

---

## Before you start

- **Workspace:**
  - Work in `~/.config/superpowers/worktrees/invoice-generator/dgii-606`, branch `dgii-606`, which
    sits on top of `dgii-ecf`. Run every command from there.
  - Use Node 22: `source ~/.nvm/nvm.sh && nvm use 22`.
  - Baseline: `npm test` gives 18 files and 218 tests passing.
- **Conventions:** read `lib/ecf/calculo.ts` and `lib/storage/archivos.ts` before writing anything.
  - Identifiers, comments, test names and user-facing messages are in Spanish. Commit messages are
    in English, with no co-author trailer.
  - Money is decimal text counted in integer cents, never floats.
  - Comments say why, citing the DGII document.
  - Error messages name the wrong field and what was expected.
- **Commands:**
  - One test file: `npx vitest run <path>`. Everything: `npm test`.
  - Types: `npx next typegen && npx tsc --noEmit`. `typegen` generates `PageProps` for new pages.
  - Lint: `npm run lint`.
- **Blocker:** Task 8 needs DGII's current 606 Excel tool, downloaded by Gabriel into
  `~/Downloads`. Tasks 1–7 and 13 don't need it. Never open files named `DGII_F_*`: those are
  Gabriel's own reports.

---

### Task 1: Montos del 606

**Files:**
- Create: `lib/compras/montos.ts`
- Test: `lib/compras/montos.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { aCentavos, aMonto, esMonto } from './montos';

describe('montos del 606', () => {
  // NG 07-2018, Anexo A: los montos del 606 son N 12, con punto decimal.
  it('acepta hasta nueve enteros y dos decimales, con punto', () => {
    for (const valor of ['0', '1500', '1500.5', '1500.50', '999999999.99']) {
      expect(esMonto(valor)).toBe(true);
    }
  });

  it('rechaza lo que no cabe o no es un monto', () => {
    for (const valor of ['', '-1', '1,500.00', '1500.505', '1000000000.00', '.50', '1e3', ' 15']) {
      expect(esMonto(valor)).toBe(false);
    }
  });

  it('pasa a centavos sin punto flotante', () => {
    expect(aCentavos('1500.5', 'ITBIS facturado')).toBe(BigInt(150050));
    expect(aCentavos('0.07', 'ITBIS facturado')).toBe(BigInt(7));
  });

  it('dice qué campo tiene el monto inválido', () => {
    expect(() => aCentavos('1,500', 'Monto facturado en bienes')).toThrow(
      /Monto facturado en bienes inválido: 1,500/
    );
  });

  it('escribe los centavos con dos decimales', () => {
    expect(aMonto(BigInt(150050))).toBe('1500.50');
    expect(aMonto(BigInt(7))).toBe('0.07');
    expect(aMonto(BigInt(0))).toBe('0.00');
  });
});
```

**Step 2: Run it to see it fail**

Run: `npx vitest run lib/compras/montos.test.ts`
Expected: FAIL with `Failed to resolve import "./montos"`.

**Step 3: Write the implementation**

```ts
// NG 07-2018, Anexo A: los montos del 606 son N 12 con punto decimal, así que con dos decimales
// caben nueve enteros. Como en lib/ecf/calculo.ts, se cuenta en centavos para no pasar nunca
// por punto flotante.
const MONTO = /^\d{1,9}(\.\d{1,2})?$/;

export const esMonto = (valor: string): boolean => typeof valor === 'string' && MONTO.test(valor);

export function aCentavos(valor: string, campo: string): bigint {
  if (!esMonto(valor)) {
    throw new Error(`${campo} inválido: ${valor}. Hasta 9 enteros y 2 decimales, con punto.`);
  }
  const [enteros, fraccion = ''] = valor.split('.');
  return BigInt(enteros + fraccion.padEnd(2, '0'));
}

export function aMonto(centavos: bigint): string {
  const digitos = centavos.toString().padStart(3, '0');
  return `${digitos.slice(0, -2)}.${digitos.slice(-2)}`;
}
```

**Step 4: Run it to see it pass**

Run: `npx vitest run lib/compras/montos.test.ts`
Expected: PASS, 5 tests.

**Step 5: Commit**

```bash
git add lib/compras/montos.ts lib/compras/montos.test.ts
git commit -m "feat(compras): 606 amounts in cents"
```

---

### Task 2: Fechas y periodos

**Files:**
- Create: `lib/compras/fechas.ts`
- Test: `lib/compras/fechas.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import {
  desdeElNavegador,
  esFecha,
  esPeriodo,
  haciaElNavegador,
  nombreDelPeriodo,
  periodoAnterior,
  periodoEnRD,
  periodoSiguiente,
  ultimoDiaDelPeriodo,
} from './fechas';

describe('fechas del 606', () => {
  it('acepta una fecha AAAAMMDD que existe', () => {
    expect(esFecha('20260913')).toBe(true);
    expect(esFecha('20240229')).toBe(true);
  });

  it('rechaza fechas que no existen o que traen otro formato', () => {
    for (const valor of ['20260931', '20250229', '2026-09-13', '13-09-2026', '2026091', '']) {
      expect(esFecha(valor)).toBe(false);
    }
  });

  // El formato vigente del 606 rige desde el periodo mayo de 2018.
  it('acepta periodos AAAAMM desde mayo de 2018', () => {
    expect(esPeriodo('201805')).toBe(true);
    expect(esPeriodo('202609')).toBe(true);
    for (const valor of ['201804', '202613', '202600', '2026-09', '']) {
      expect(esPeriodo(valor)).toBe(false);
    }
  });

  it('da el último día del periodo', () => {
    expect(ultimoDiaDelPeriodo('202602')).toBe('20260228');
    expect(ultimoDiaDelPeriodo('202402')).toBe('20240229');
    expect(ultimoDiaDelPeriodo('202609')).toBe('20260930');
  });

  it('pasa entre la fecha del navegador y AAAAMMDD', () => {
    expect(desdeElNavegador('2026-09-13')).toBe('20260913');
    expect(haciaElNavegador('20260913')).toBe('2026-09-13');
    expect(() => desdeElNavegador('13/09/2026')).toThrow(/Fecha inválida/);
  });

  // República Dominicana está en GMT-4 todo el año.
  it('da el periodo en la hora de República Dominicana', () => {
    expect(periodoEnRD(new Date('2026-10-01T02:00:00Z'))).toBe('202609');
    expect(periodoEnRD(new Date('2026-10-01T05:00:00Z'))).toBe('202610');
  });

  it('mueve el periodo un mes', () => {
    expect(periodoAnterior('202601')).toBe('202512');
    expect(periodoSiguiente('202612')).toBe('202701');
  });

  it('nombra el periodo en español', () => {
    expect(nombreDelPeriodo('202609')).toBe('septiembre de 2026');
  });
});
```

**Step 2: Run it to see it fail**

Run: `npx vitest run lib/compras/fechas.test.ts`
Expected: FAIL with `Failed to resolve import "./fechas"`.

**Step 3: Write the implementation**

```ts
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
```

**Step 4: Run it to see it pass**

Run: `npx vitest run lib/compras/fechas.test.ts`
Expected: PASS, 8 tests.

**Step 5: Commit**

```bash
git add lib/compras/fechas.ts lib/compras/fechas.test.ts
git commit -m "feat(compras): 606 dates and periods"
```

---

### Task 3: Tipos de la compra

**Files:**
- Create: `lib/compras/tipos.ts`
- Create: `lib/compras/ejemplos.ts` (for tests only)
- Test: `lib/compras/tipos.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { compraDePrueba } from './ejemplos';
import {
  claveDeCompra,
  esClaveDeCompra,
  esCodigo,
  exigirClaveDeCompra,
  FORMAS_DE_PAGO,
  TIPOS_DE_BIENES_Y_SERVICIOS,
  TIPOS_DE_RETENCION_ISR,
} from './tipos';

describe('tipos de la compra', () => {
  // Instructivo del 606, casillas 3, 17 y 23.
  it('tiene los códigos del instructivo del 606', () => {
    expect(Object.keys(TIPOS_DE_BIENES_Y_SERVICIOS)).toHaveLength(11);
    expect(Object.keys(TIPOS_DE_RETENCION_ISR)).toHaveLength(9);
    expect(Object.keys(FORMAS_DE_PAGO)).toHaveLength(7);
    expect(esCodigo(FORMAS_DE_PAGO, '7')).toBe(true);
    expect(esCodigo(FORMAS_DE_PAGO, '8')).toBe(false);
  });

  it('usa el proveedor y el NCF como llave', () => {
    expect(claveDeCompra(compraDePrueba())).toBe('987654321_B0100000123');
  });

  it('reconoce una clave de compra', () => {
    for (const clave of ['987654321_B0100000123', '00100000001_E310000000001']) {
      expect(esClaveDeCompra(clave)).toBe(true);
    }
  });

  // La clave termina en un nombre de archivo.
  it('rechaza lo que no es una clave de compra', () => {
    for (const clave of ['../emisor', '98765432_B0100000123', '987654321_b0100000123', '987654321_B01']) {
      expect(esClaveDeCompra(clave)).toBe(false);
    }
    expect(() => exigirClaveDeCompra('../emisor')).toThrow(/Clave de compra inválida/);
  });
});
```

**Step 2: Run it to see it fail**

Run: `npx vitest run lib/compras/tipos.test.ts`
Expected: FAIL with `Failed to resolve import "./ejemplos"`.

**Step 3: Write `lib/compras/tipos.ts`**

```ts
// Códigos y nombres del instructivo del Formato de Envío 606 (febrero de 2026): casilla 3, tipo de
// bienes y servicios; casilla 17, tipo de retención en ISR; casilla 23, forma de pago.
export const TIPOS_DE_BIENES_Y_SERVICIOS = {
  '1': 'Gastos de personal',
  '2': 'Gastos por trabajos, suministros y servicios',
  '3': 'Arrendamientos',
  '4': 'Gastos de activos fijos',
  '5': 'Gastos de representación',
  '6': 'Otras deducciones admitidas',
  '7': 'Gastos financieros',
  '8': 'Gastos extraordinarios',
  '9': 'Compras y gastos que formarán parte del costo de venta',
  '10': 'Adquisiciones de activos',
  '11': 'Gastos de seguros',
} as const;

export const TIPOS_DE_RETENCION_ISR = {
  '1': 'Alquileres',
  '2': 'Honorarios por servicios',
  '3': 'Otras rentas',
  '4': 'Otras rentas (rentas presuntas)',
  '5': 'Intereses pagados a personas jurídicas residentes',
  '6': 'Intereses pagados a personas físicas residentes',
  '7': 'Retención por proveedores del Estado',
  '8': 'Juegos telefónicos',
  '9': 'Retenciones subsector de ganadería de carne bovina',
} as const;

export const FORMAS_DE_PAGO = {
  '1': 'Efectivo',
  '2': 'Cheques, transferencias o depósito',
  '3': 'Tarjeta de crédito o débito',
  '4': 'Compra a crédito',
  '5': 'Permuta',
  '6': 'Notas de crédito',
  '7': 'Mixto',
} as const;

export type TipoBienesServicios = keyof typeof TIPOS_DE_BIENES_Y_SERVICIOS;
export type TipoRetencionISR = keyof typeof TIPOS_DE_RETENCION_ISR;
export type FormaPago = keyof typeof FORMAS_DE_PAGO;

export const esCodigo = <T extends string>(tabla: Record<T, string>, valor: string): valor is T =>
  Object.hasOwn(tabla, valor);

// Una compra con las casillas del 606 que se anotan. Los montos van como texto decimal y las
// fechas AAAAMMDD, como en el archivo. El total, el ITBIS por adelantar y las dos percepciones no
// se guardan: el archivo los calcula o los deja vacíos.
export interface Compra {
  RNCCedula: string;
  TipoBienesServicios: TipoBienesServicios;
  NCF: string;
  NCFModificado?: string;
  FechaComprobante: string;
  FechaPago?: string;
  MontoServicios: string;
  MontoBienes: string;
  ITBISFacturado: string;
  ITBISRetenido?: string;
  ITBISProporcionalidad?: string;
  ITBISCosto?: string;
  TipoRetencionISR?: TipoRetencionISR;
  MontoRetencionRenta?: string;
  ImpuestoSelectivo?: string;
  OtrosImpuestos?: string;
  PropinaLegal?: string;
  FormaPago: FormaPago;
}

// El proveedor y el NCF son la llave: la DGII marca como error el mismo NCF de un proveedor
// reportado dos veces.
export const claveDeCompra = ({ RNCCedula, NCF }: Pick<Compra, 'RNCCedula' | 'NCF'>): string =>
  `${RNCCedula}_${NCF}`;

// La clave termina en un nombre de archivo: solo el RNC o la cédula, un guion bajo y un NCF.
export const esClaveDeCompra = (valor: string): boolean =>
  typeof valor === 'string' && /^(\d{9}|\d{11})_(B\d{10}|E\d{12})$/.test(valor);

export function exigirClaveDeCompra(clave: string): string {
  if (!esClaveDeCompra(clave)) {
    throw new Error(
      `Clave de compra inválida: ${clave}. Es el RNC o la cédula, un guion bajo y el NCF.`
    );
  }
  return clave;
}
```

**Step 4: Write `lib/compras/ejemplos.ts`**

```ts
// Solo para pruebas: una compra válida, y cada prueba cambia lo que necesita.
import type { Compra } from './tipos';

export const compraDePrueba = (cambios: Partial<Compra> = {}): Compra => ({
  RNCCedula: '987654321',
  TipoBienesServicios: '2',
  NCF: 'B0100000123',
  FechaComprobante: '20260905',
  MontoServicios: '1000.00',
  MontoBienes: '0.00',
  ITBISFacturado: '180.00',
  FormaPago: '1',
  ...cambios,
});
```

**Step 5: Run it to see it pass**

Run: `npx vitest run lib/compras/tipos.test.ts`
Expected: PASS, 4 tests.

**Step 6: Commit**

```bash
git add lib/compras/tipos.ts lib/compras/ejemplos.ts lib/compras/tipos.test.ts
git commit -m "feat(compras): purchase fields and codes from the 606 instructions"
```

---

### Task 4: Qué entra en el 606 de un mes

**Files:**
- Create: `lib/compras/periodo.ts`
- Test: `lib/compras/periodo.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { compraDePrueba } from './ejemplos';
import { comprasDelPeriodo } from './periodo';

describe('qué entra en el 606 de un mes', () => {
  it('lleva las compras con comprobante del mes', () => {
    const septiembre = compraDePrueba();
    const octubre = compraDePrueba({ NCF: 'B0100000124', FechaComprobante: '20261002' });
    expect(comprasDelPeriodo([septiembre, octubre], '202609')).toEqual([septiembre]);
  });

  it('deja la fecha de pago y las retenciones si se pagó dentro del mes', () => {
    const compra = compraDePrueba({ FechaPago: '20260930', ITBISRetenido: '54.00' });
    expect(comprasDelPeriodo([compra], '202609')).toEqual([compra]);
  });

  it('quita el pago y las retenciones si se pagó después del mes', () => {
    const compra = compraDePrueba({
      FechaPago: '20261005',
      ITBISRetenido: '54.00',
      TipoRetencionISR: '2',
      MontoRetencionRenta: '100.00',
    });
    expect(comprasDelPeriodo([compra], '202609')).toEqual([compraDePrueba()]);
  });

  // Instructivo del 606: el NCF se reenvía en el mes del pago, con su fecha original.
  it('reenvía en el mes del pago una compra anterior con retención', () => {
    const compra = compraDePrueba({ FechaComprobante: '20260825', FechaPago: '20260910', ITBISRetenido: '54.00' });
    expect(comprasDelPeriodo([compra], '202608')).toEqual([compraDePrueba({ FechaComprobante: '20260825' })]);
    expect(comprasDelPeriodo([compra], '202609')).toEqual([compra]);
  });

  it('no reenvía una compra anterior pagada sin retenciones', () => {
    const compra = compraDePrueba({ FechaComprobante: '20260825', FechaPago: '20260910' });
    expect(comprasDelPeriodo([compra], '202609')).toEqual([]);
  });

  it('ordena por fecha del comprobante, proveedor y NCF', () => {
    const c = compraDePrueba({ FechaComprobante: '20260920' });
    const b = compraDePrueba({ RNCCedula: '123456789', NCF: 'B0100000999' });
    const a = compraDePrueba({ RNCCedula: '123456789', NCF: 'B0100000001' });
    expect(comprasDelPeriodo([c, b, a], '202609')).toEqual([a, b, c]);
  });

  it('rechaza un periodo inválido', () => {
    expect(() => comprasDelPeriodo([], '2026-09')).toThrow(/Periodo inválido/);
  });
});
```

**Step 2: Run it to see it fail**

Run: `npx vitest run lib/compras/periodo.test.ts`
Expected: FAIL with `Failed to resolve import "./periodo"`.

**Step 3: Write the implementation**

```ts
import { esPeriodo, ultimoDiaDelPeriodo } from './fechas';
import { aCentavos, esMonto } from './montos';
import type { Compra } from './tipos';

const CERO = BigInt(0);

const positivo = (valor: string | undefined) =>
  valor !== undefined && esMonto(valor) && aCentavos(valor, 'Monto') > CERO;

const tieneRetenciones = (compra: Compra) =>
  positivo(compra.ITBISRetenido) || positivo(compra.MontoRetencionRenta);

// Sin pago dentro del mes, el comprobante sale sin fecha de pago y sin retenciones: esas se
// reportan en el mes en que se paga.
function sinPago(compra: Compra): Compra {
  const copia = { ...compra };
  delete copia.FechaPago;
  delete copia.ITBISRetenido;
  delete copia.TipoRetencionISR;
  delete copia.MontoRetencionRenta;
  return copia;
}

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const orden = (a: Compra, b: Compra) =>
  comparar(a.FechaComprobante, b.FechaComprobante) ||
  comparar(a.RNCCedula, b.RNCCedula) ||
  comparar(a.NCF, b.NCF);

// Lo que va en el 606 de un periodo AAAAMM:
// 1. Las compras con comprobante del periodo. Llevan fecha de pago y retenciones solo si el pago
//    no pasa del último día del periodo.
// 2. Las compras de periodos anteriores pagadas en este con alguna retención, con su fecha
//    original: el instructivo del 606 pide reenviar así el NCF para reportarlas.
export function comprasDelPeriodo(compras: Compra[], periodo: string): Compra[] {
  if (!esPeriodo(periodo)) {
    throw new Error(`Periodo inválido: ${periodo}. Formato AAAAMM, desde 201805.`);
  }
  const ultimoDia = ultimoDiaDelPeriodo(periodo);
  const lineas: Compra[] = [];
  for (const compra of compras) {
    const periodoDelComprobante = compra.FechaComprobante.slice(0, 6);
    if (periodoDelComprobante === periodo) {
      const pagadaEnElMes = compra.FechaPago !== undefined && compra.FechaPago <= ultimoDia;
      lineas.push(pagadaEnElMes ? compra : sinPago(compra));
    } else if (
      periodoDelComprobante < periodo &&
      compra.FechaPago?.slice(0, 6) === periodo &&
      tieneRetenciones(compra)
    ) {
      lineas.push(compra);
    }
  }
  return lineas.sort(orden);
}
```

**Step 4: Run it to see it pass**

Run: `npx vitest run lib/compras/periodo.test.ts`
Expected: PASS, 7 tests.

**Step 5: Commit**

```bash
git add lib/compras/periodo.ts lib/compras/periodo.test.ts
git commit -m "feat(compras): which purchases go in each month's 606"
```

---

### Task 5: Guardar compras

**Files:**
- Modify: `lib/storage/tipos.ts` (the `Almacenamiento` interface)
- Modify: `lib/storage/contrato.ts` (the contract both implementations run)
- Modify: `lib/storage/memoria.ts`
- Modify: `lib/storage/archivos.ts`
- Test: `lib/storage/archivos.test.ts` (file-only behavior)

**Step 1: Write the failing contract tests**

In `lib/storage/contrato.ts`, add these imports under the existing ones:

```ts
import { compraDePrueba } from '../compras/ejemplos';
import { claveDeCompra } from '../compras/tipos';
```

Inside `probarContratoDeAlmacenamiento`, after the closing `});` of the existing
`describe(\`almacenamiento ${nombre}\`, …)`, add:

```ts
  describe(`compras ${nombre}`, () => {
    it('guarda una compra y la lista', async () => {
      const almacen = await crear(emisorDePrueba());
      await almacen.guardarCompra(compraDePrueba());
      expect(await almacen.listarCompras()).toEqual([compraDePrueba()]);
    });

    it('rechaza el mismo NCF del mismo proveedor dos veces', async () => {
      const almacen = await crear(emisorDePrueba());
      await almacen.guardarCompra(compraDePrueba());
      await expect(
        almacen.guardarCompra(compraDePrueba({ MontoServicios: '5.00' }))
      ).rejects.toThrow(/duplicad/i);
      expect(await almacen.listarCompras()).toEqual([compraDePrueba()]);
    });

    it('guarda el mismo NCF de dos proveedores distintos', async () => {
      const almacen = await crear(emisorDePrueba());
      await almacen.guardarCompra(compraDePrueba());
      await almacen.guardarCompra(compraDePrueba({ RNCCedula: '123456789' }));
      expect(await almacen.listarCompras()).toHaveLength(2);
    });

    it('deja pasar uno solo de dos guardados simultáneos de la misma compra', async () => {
      const almacen = await crear(emisorDePrueba());
      const resultados = await Promise.allSettled([
        almacen.guardarCompra(compraDePrueba()),
        almacen.guardarCompra(compraDePrueba()),
      ]);
      expect(resultados.filter((resultado) => resultado.status === 'fulfilled')).toHaveLength(1);
    });

    it('reemplaza una compra sin cambiar su llave', async () => {
      const almacen = await crear(emisorDePrueba());
      await almacen.guardarCompra(compraDePrueba());
      await almacen.reemplazarCompra(compraDePrueba({ MontoServicios: '2000.00' }));
      expect(await almacen.listarCompras()).toEqual([compraDePrueba({ MontoServicios: '2000.00' })]);
    });

    it('rechaza reemplazar una compra que no está guardada', async () => {
      const almacen = await crear(emisorDePrueba());
      await expect(almacen.reemplazarCompra(compraDePrueba())).rejects.toThrow(/No hay una compra/);
    });

    it('borra una compra', async () => {
      const almacen = await crear(emisorDePrueba());
      await almacen.guardarCompra(compraDePrueba());
      await almacen.borrarCompra(claveDeCompra(compraDePrueba()));
      expect(await almacen.listarCompras()).toEqual([]);
    });

    it('rechaza borrar una compra que no está guardada', async () => {
      const almacen = await crear(emisorDePrueba());
      await expect(almacen.borrarCompra('987654321_B0100000123')).rejects.toThrow(
        /No hay una compra/
      );
    });

    it('rechaza una clave que no es de compra', async () => {
      const almacen = await crear(emisorDePrueba());
      await expect(almacen.borrarCompra('../emisor')).rejects.toThrow(/Clave de compra inválida/);
      await expect(almacen.guardarCompra(compraDePrueba({ NCF: '../emisor' }))).rejects.toThrow(
        /Clave de compra inválida/
      );
    });

    it('no deja que quien lee una compra cambie la guardada', async () => {
      const almacen = await crear(emisorDePrueba());
      await almacen.guardarCompra(compraDePrueba());
      const [leida] = await almacen.listarCompras();
      leida.MontoServicios = '1.00';
      expect(await almacen.listarCompras()).toEqual([compraDePrueba()]);
    });
  });
```

In `lib/storage/archivos.test.ts`, add `existsSync` to the `node:fs` import, add
`import { compraDePrueba } from '../compras/ejemplos';`, and append:

```ts
describe('compras en archivos', () => {
  it('guarda cada compra como compras/<RNC>_<NCF>.json, con su XML al lado', async () => {
    const directorio = carpetaDeDatos();
    await new AlmacenamientoEnArchivos(directorio).guardarCompra(compraDePrueba(), '<ECF/>');
    const compras = join(directorio, 'compras');
    expect(JSON.parse(readFileSync(join(compras, '987654321_B0100000123.json'), 'utf8'))).toEqual(
      compraDePrueba()
    );
    expect(readFileSync(join(compras, '987654321_B0100000123.xml'), 'utf8')).toBe('<ECF/>');
  });

  it('borra la compra y su XML', async () => {
    const directorio = carpetaDeDatos();
    const almacen = new AlmacenamientoEnArchivos(directorio);
    await almacen.guardarCompra(compraDePrueba(), '<ECF/>');
    await almacen.borrarCompra('987654321_B0100000123');
    expect(existsSync(join(directorio, 'compras', '987654321_B0100000123.json'))).toBe(false);
    expect(existsSync(join(directorio, 'compras', '987654321_B0100000123.xml'))).toBe(false);
  });

  it('ignora en compras/ lo que no es una compra', async () => {
    const directorio = carpetaDeDatos();
    mkdirSync(join(directorio, 'compras'));
    for (const nombre of ['.DS_Store', 'notas.json', '987654321_B0100000123.json.bak']) {
      writeFileSync(join(directorio, 'compras', nombre), '{}');
    }
    expect(await new AlmacenamientoEnArchivos(directorio).listarCompras()).toEqual([]);
  });
});
```

**Step 2: Run them to see them fail**

Run: `npx vitest run lib/storage`
Expected: FAIL. `tsc` would also complain; at runtime the error is `almacen.guardarCompra is not a function`.

**Step 3: Extend the interface in `lib/storage/tipos.ts`**

Add `import type { Compra } from '../compras/tipos';` and these members at the end of
`Almacenamiento`:

```ts
  // Compras para el 606. La llave es el proveedor y el NCF (claveDeCompra).
  guardarCompra(compra: Compra, xml?: string): Promise<void>;
  reemplazarCompra(compra: Compra): Promise<void>;
  borrarCompra(clave: string): Promise<void>;
  listarCompras(): Promise<Compra[]>;
```

**Step 4: Implement it in `lib/storage/memoria.ts`**

Add `import { claveDeCompra, exigirClaveDeCompra, type Compra } from '../compras/tipos';`, the
field `private readonly compras = new Map<string, { compra: Compra; xml?: string }>();` next to
`comprobantes`, and these methods at the end of the class:

```ts
  async guardarCompra(compra: Compra, xml?: string): Promise<void> {
    const clave = exigirClaveDeCompra(claveDeCompra(compra));
    // Comprobar y escribir en el mismo tick, como con los comprobantes.
    if (this.compras.has(clave)) {
      throw new Error(`Compra duplicada: ${compra.NCF} de ${compra.RNCCedula} ya está anotada.`);
    }
    this.compras.set(clave, { compra: structuredClone(compra), xml });
  }

  async reemplazarCompra(compra: Compra): Promise<void> {
    const clave = exigirClaveDeCompra(claveDeCompra(compra));
    const guardada = this.compras.get(clave);
    if (guardada === undefined) throw new Error(`No hay una compra ${clave}.`);
    this.compras.set(clave, { ...guardada, compra: structuredClone(compra) });
  }

  async borrarCompra(clave: string): Promise<void> {
    exigirClaveDeCompra(clave);
    if (!this.compras.delete(clave)) throw new Error(`No hay una compra ${clave}.`);
  }

  async listarCompras(): Promise<Compra[]> {
    return [...this.compras.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([, { compra }]) => structuredClone(compra));
  }
```

**Step 5: Implement it in `lib/storage/archivos.ts`**

Change the `node:fs/promises` import to
`import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';` and add
`import { claveDeCompra, esClaveDeCompra, exigirClaveDeCompra, type Compra } from '../compras/tipos';`.

Extend the comment at the top of the class: `…y una compra por archivo en datos/compras/<RNC>_<NCF>.json.`
Add the field `private readonly compras: string;` and, in the constructor,
`this.compras = join(directorio, 'compras');`. Then add at the end of the class:

```ts
  async guardarCompra(compra: Compra, xml?: string): Promise<void> {
    const clave = exigirClaveDeCompra(claveDeCompra(compra));
    await mkdir(this.compras, { recursive: true });
    const ruta = join(this.compras, `${clave}.json`);
    try {
      // wx: el JSON de la compra es el índice único, como el XML de las facturas.
      await writeFile(ruta, `${JSON.stringify(compra, null, 2)}\n`, { flag: 'wx' });
    } catch (error) {
      if (codigo(error) === 'EEXIST') {
        throw new Error(
          `Compra duplicada: ${compra.NCF} de ${compra.RNCCedula} ya está anotada (EEXIST).`,
          { cause: error }
        );
      }
      throw error;
    }
    if (xml === undefined) return;
    try {
      await writeFile(join(this.compras, `${clave}.xml`), xml);
    } catch (error) {
      // Una compra importada no queda sin su XML: se deshace.
      await rm(ruta, { force: true });
      throw error;
    }
  }

  async reemplazarCompra(compra: Compra): Promise<void> {
    const clave = exigirClaveDeCompra(claveDeCompra(compra));
    const ruta = join(this.compras, `${clave}.json`);
    try {
      await access(ruta);
    } catch (error) {
      if (codigo(error) === 'ENOENT') throw new Error(`No hay una compra ${clave}.`, { cause: error });
      throw error;
    }
    await writeFile(ruta, `${JSON.stringify(compra, null, 2)}\n`);
  }

  async borrarCompra(clave: string): Promise<void> {
    exigirClaveDeCompra(clave);
    try {
      await rm(join(this.compras, `${clave}.json`));
    } catch (error) {
      if (codigo(error) === 'ENOENT') throw new Error(`No hay una compra ${clave}.`, { cause: error });
      throw error;
    }
    await rm(join(this.compras, `${clave}.xml`), { force: true });
  }

  async listarCompras(): Promise<Compra[]> {
    let nombres: string[];
    try {
      nombres = await readdir(this.compras);
    } catch (error) {
      if (codigo(error) === 'ENOENT') return [];
      throw error;
    }
    const claves = nombres
      .filter((nombre) => nombre.endsWith('.json') && esClaveDeCompra(nombre.slice(0, -5)))
      .map((nombre) => nombre.slice(0, -5))
      .sort();
    return Promise.all(
      claves.map(
        async (clave) =>
          JSON.parse(await readFile(join(this.compras, `${clave}.json`), 'utf8')) as Compra
      )
    );
  }
```

**Step 6: Run them to see them pass**

Run: `npx vitest run lib/storage && npx tsc --noEmit`
Expected: PASS, including 10 new contract tests in each implementation and 3 file tests, with no
type errors.

**Step 7: Commit**

```bash
git add lib/storage lib/compras/ejemplos.ts
git commit -m "feat(storage): purchases, one JSON per supplier and NCF"
```

---

### Task 6: Importar un e-CF

**Files:**
- Create: `lib/compras/desdeECF.ts`
- Test: `lib/compras/desdeECF.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { crearCredencialDeDemostracion } from '../credencial';
import { validarContraXSD } from '../ecf/validar';
import { emitirECF, type SolicitudDeEmision } from '../emitir';
import { leerEsquema } from '../esquemas';
import { emisorDePrueba } from '../storage/contrato';
import { AlmacenamientoEnMemoria } from '../storage/memoria';
import { importarECF, type DependenciasDeImportacion } from './desdeECF';

// El negocio que compra. El proveedor es emisorDePrueba, con RNC 123456789.
const NEGOCIO = '101010101';
const credencial = crearCredencialDeDemostracion();

const conXSD: DependenciasDeImportacion = {
  rncDelNegocio: NEGOCIO,
  validar: (xml, tipo) => validarContraXSD(xml, leerEsquema(tipo)),
};

// Para los casos que el emisor de este proyecto no arma (tabla de pagos, impuestos adicionales,
// retenciones, notas): se edita el XML, y la firma deja de valer, así que se salta el XSD.
const sinXSD: DependenciasDeImportacion = {
  rncDelNegocio: NEGOCIO,
  validar: async () => ({ valido: true, errores: [] }),
};

const factura: SolicitudDeEmision = {
  tipo: '31',
  IndicadorMontoGravado: 0,
  TipoIngresos: '01',
  TipoPago: 1,
  Comprador: { RNCComprador: NEGOCIO, RazonSocialComprador: 'Nuestro Negocio SRL' },
  Items: [
    {
      NombreItem: 'Resma de papel',
      IndicadorBienoServicio: 1,
      CantidadItem: '2',
      PrecioUnitarioItem: '250.00',
      IndicadorFacturacion: 1,
    },
  ],
};

async function ecf(cambios: Partial<SolicitudDeEmision> = {}): Promise<string> {
  const resultado = await emitirECF(
    { ...factura, ...cambios },
    {
      almacenamiento: new AlmacenamientoEnMemoria(emisorDePrueba()),
      credencial: () => credencial,
      leerEsquema,
      ahora: () => new Date('2026-09-12T14:30:00Z'),
    }
  );
  if (!resultado.emitido) throw new Error(resultado.errores.join(' '));
  return resultado.xml;
}

describe('importar un e-CF recibido', () => {
  it('llena la compra con lo que dice un e-CF 31 válido', async () => {
    expect(await importarECF(await ecf(), conXSD)).toEqual({
      importado: true,
      borrador: {
        RNCCedula: '123456789',
        NCF: 'E310000000001',
        FechaComprobante: '20260912',
        MontoServicios: '0.00',
        MontoBienes: '500.00',
        ITBISFacturado: '90.00',
      },
      porCompletar: ['TipoBienesServicios', 'FormaPago'],
    });
  });

  // Con los precios con ITBIS, el monto sin impuestos sale de MontoGravadoTotal.
  it('reparte el monto sin impuestos entre bienes y servicios', async () => {
    const xml = await ecf({
      IndicadorMontoGravado: 1,
      Items: [
        { NombreItem: 'Resma de papel', IndicadorBienoServicio: 1, CantidadItem: '1', PrecioUnitarioItem: '354.00', IndicadorFacturacion: 1 },
        { NombreItem: 'Instalación', IndicadorBienoServicio: 2, CantidadItem: '1', PrecioUnitarioItem: '236.00', IndicadorFacturacion: 1 },
      ],
    });
    expect(await importarECF(xml, conXSD)).toMatchObject({
      importado: true,
      borrador: { MontoBienes: '300.00', MontoServicios: '200.00', ITBISFacturado: '90.00' },
    });
  });

  it('una venta a crédito sin tabla de pagos es una compra a crédito', async () => {
    const xml = await ecf({ TipoPago: 2, FechaLimitePago: '30-09-2026' });
    expect(await importarECF(xml, conXSD)).toMatchObject({
      importado: true,
      borrador: { FormaPago: '4' },
      porCompletar: ['TipoBienesServicios'],
    });
  });

  it('traduce una sola forma de pago y marca como mixtas varias', async () => {
    const forma = (codigo: string, monto: string) =>
      `<FormaDePago><FormaPago>${codigo}</FormaPago><MontoPago>${monto}</MontoPago></FormaDePago>`;
    const base = await ecf();
    const permuta = base.replace('</TipoPago>', `</TipoPago><TablaFormasPago>${forma('6', '590.00')}</TablaFormasPago>`);
    const mixta = base.replace(
      '</TipoPago>',
      `</TipoPago><TablaFormasPago>${forma('1', '300.00')}${forma('3', '290.00')}</TablaFormasPago>`
    );
    expect(await importarECF(permuta, sinXSD)).toMatchObject({ borrador: { FormaPago: '5' } });
    expect(await importarECF(mixta, sinXSD)).toMatchObject({ borrador: { FormaPago: '7' } });
  });

  // Formato e-CF, Tabla I: 001 propina legal; 002 y 005 otros; 003, 004 y del 006 al 039, selectivo.
  it('reparte los impuestos adicionales en propina, otros impuestos y selectivo', async () => {
    const impuesto = (tipo: string, monto: string) =>
      `<ImpuestoAdicional><TipoImpuesto>${tipo}</TipoImpuesto><TasaImpuestoAdicional>10</TasaImpuestoAdicional>${monto}</ImpuestoAdicional>`;
    const xml = (await ecf()).replace(
      '<MontoTotal>',
      '<ImpuestosAdicionales>' +
        impuesto('001', '<OtrosImpuestosAdicionales>50.00</OtrosImpuestosAdicionales>') +
        impuesto('002', '<OtrosImpuestosAdicionales>5.00</OtrosImpuestosAdicionales>') +
        impuesto('006', '<MontoImpuestoSelectivoConsumoEspecifico>20.00</MontoImpuestoSelectivoConsumoEspecifico>') +
        '</ImpuestosAdicionales><MontoTotal>'
    );
    expect(await importarECF(xml, sinXSD)).toMatchObject({
      borrador: { PropinaLegal: '50.00', OtrosImpuestos: '5.00', ImpuestoSelectivo: '20.00' },
    });
  });

  it('trae las retenciones y pide la fecha de pago y el tipo de retención', async () => {
    const xml = (await ecf()).replace(
      '</MontoTotal>',
      '</MontoTotal><TotalITBISRetenido>27.00</TotalITBISRetenido><TotalISRRetencion>50.00</TotalISRRetencion>'
    );
    expect(await importarECF(xml, sinXSD)).toMatchObject({
      borrador: { ITBISRetenido: '27.00', MontoRetencionRenta: '50.00' },
      porCompletar: ['TipoBienesServicios', 'FormaPago', 'FechaPago', 'TipoRetencionISR'],
    });
  });

  it('importa una nota de crédito con el NCF que modifica', async () => {
    const xml = (await ecf())
      .replace('<TipoeCF>31</TipoeCF><eNCF>E310000000001</eNCF>', '<TipoeCF>34</TipoeCF><eNCF>E340000000001</eNCF>')
      .replace(/<FechaVencimientoSecuencia>[^<]*<\/FechaVencimientoSecuencia>/, '')
      .replace(
        '<FechaHoraFirma>',
        '<InformacionReferencia><NCFModificado>E310000000009</NCFModificado><FechaNCFModificado>01-09-2026</FechaNCFModificado><CodigoModificacion>3</CodigoModificacion></InformacionReferencia><FechaHoraFirma>'
      );
    expect(await importarECF(xml, sinXSD)).toMatchObject({
      importado: true,
      borrador: { NCF: 'E340000000001', NCFModificado: 'E310000000009' },
    });
  });

  it('rechaza una factura de consumo', async () => {
    expect(await importarECF(await ecf({ tipo: '32', Comprador: undefined }), conXSD)).toEqual({
      importado: false,
      errores: [expect.stringMatching(/factura de consumo/)],
    });
  });

  it('rechaza un e-CF que es para otro RNC', async () => {
    const xml = await ecf({ Comprador: { RNCComprador: '222222222', RazonSocialComprador: 'Otro Negocio SRL' } });
    expect(await importarECF(xml, conXSD)).toEqual({
      importado: false,
      errores: [expect.stringMatching(/es para el RNC 222222222/)],
    });
  });

  it('rechaza un XML que no valida contra el XSD de su tipo', async () => {
    const xml = (await ecf()).replace('<TipoIngresos>01</TipoIngresos>', '');
    expect(await importarECF(xml, conXSD)).toMatchObject({
      importado: false,
      errores: [expect.stringMatching(/no valida contra el XSD/), expect.any(String)],
    });
  });

  it('rechaza los tipos que no se importan', async () => {
    const xml = (await ecf()).replace('<TipoeCF>31</TipoeCF>', '<TipoeCF>41</TipoeCF>');
    expect(await importarECF(xml, sinXSD)).toEqual({
      importado: false,
      errores: [expect.stringMatching(/31, 33 y 34/)],
    });
  });

  it('rechaza lo que no es un e-CF', async () => {
    expect(await importarECF('<Factura/>', sinXSD)).toEqual({
      importado: false,
      errores: [expect.stringMatching(/no es un e-CF/)],
    });
    expect(await importarECF('hola', sinXSD)).toMatchObject({ importado: false });
  });
});
```

**Step 2: Run it to see it fail**

Run: `npx vitest run lib/compras/desdeECF.test.ts`
Expected: FAIL with `Failed to resolve import "./desdeECF"`.

**Step 3: Write the implementation**

```ts
import { DOMParser } from '@xmldom/xmldom';
import { aMonto } from './montos';
import type { Compra, FormaPago } from './tipos';

// De un e-CF recibido sale casi toda la compra (Formato e-CF v1.0 e instructivo del 606). Lo que
// el XML no dice lo completa quien importa: siempre el tipo de bienes y servicios; la forma de pago
// cuando no se puede deducir; la fecha de pago y el tipo de retención si hay retenciones.

const TIPOS_IMPORTABLES = ['31', '33', '34'] as const;
export type TipoImportable = (typeof TIPOS_IMPORTABLES)[number];

export type CampoPorCompletar = 'TipoBienesServicios' | 'FormaPago' | 'FechaPago' | 'TipoRetencionISR';

export type BorradorDeCompra = Omit<Compra, 'TipoBienesServicios' | 'FormaPago'> &
  Partial<Pick<Compra, 'TipoBienesServicios' | 'FormaPago'>>;

export type ResultadoDeImportacion =
  | { importado: true; borrador: BorradorDeCompra; porCompletar: CampoPorCompletar[] }
  | { importado: false; errores: string[] };

export interface DependenciasDeImportacion {
  // El RNC del emisor de esta instancia: el e-CF tiene que ser para él.
  rncDelNegocio: string;
  // En la aplicación, validarContraXSD con leerEsquema(tipo).
  validar: (xml: string, tipo: TipoImportable) => Promise<{ valido: boolean; errores: string[] }>;
}

const CERO = BigInt(0);
const DOS = BigInt(2);

// Formato e-CF, TablaFormasPago: 1 efectivo, 2 cheque/transferencia/depósito, 3 tarjeta, 4 crédito,
// 5 bonos (solo en el 32), 6 permuta, 7 nota de crédito, 8 otras. Instructivo del 606, casilla 23:
// 1 efectivo, 2 cheques, 3 tarjeta, 4 compra a crédito, 5 permuta, 6 notas de crédito, 7 mixto.
const FORMA_DE_PAGO_DEL_606: Partial<Record<string, FormaPago>> = {
  '1': '1',
  '2': '2',
  '3': '3',
  '4': '4',
  '6': '5',
  '7': '6',
};

function texto(padre: Document | Element, nombre: string): string | undefined {
  return padre.getElementsByTagName(nombre)[0]?.textContent?.trim() ?? undefined;
}

// Los montos del e-CF traen hasta 16 enteros y 2 decimales.
function centavos(valor: string | undefined, campo: string): bigint {
  if (valor === undefined || valor === '') return CERO;
  if (!/^\d{1,16}(\.\d{1,2})?$/.test(valor)) throw new Error(`${campo} del e-CF inválido: ${valor}.`);
  const [enteros, fraccion = ''] = valor.split('.');
  return BigInt(enteros + fraccion.padEnd(2, '0'));
}

// dd-MM-AAAA del e-CF a AAAAMMDD del 606.
function fechaDel606(valor: string): string {
  const partes = valor.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!partes) throw new Error(`FechaEmision del e-CF inválida: ${valor}.`);
  return `${partes[3]}${partes[2]}${partes[1]}`;
}

// El 606 separa el monto sin impuestos en bienes y servicios, y el e-CF solo lo da por ítem, con
// descuentos o recargos que pueden ser globales. Se reparte el total sin impuestos
// (MontoGravadoTotal más MontoExento) en proporción a los MontoItem de cada clase. Es exacto cuando
// todos los ítems son de una clase, que es lo común, y proporcional cuando se mezclan.
function bienesYServicios(documento: Document): { bienes: bigint; servicios: bigint } {
  const base =
    centavos(texto(documento, 'MontoGravadoTotal'), 'MontoGravadoTotal') +
    centavos(texto(documento, 'MontoExento'), 'MontoExento');
  const items = documento.getElementsByTagName('Item');
  let sumaBienes = CERO;
  let sumaServicios = CERO;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    // IndicadorFacturacion 0 es no facturable: no entra en los totales.
    if (texto(item, 'IndicadorFacturacion') === '0') continue;
    const monto = centavos(texto(item, 'MontoItem'), 'MontoItem');
    if (texto(item, 'IndicadorBienoServicio') === '2') sumaServicios += monto;
    else sumaBienes += monto;
  }
  const suma = sumaBienes + sumaServicios;
  if (suma === CERO) return { bienes: base, servicios: CERO };
  // Redondeo al centavo, la mitad hacia arriba, como en lib/ecf/calculo.ts.
  const servicios = (base * sumaServicios * DOS + suma) / (suma * DOS);
  return { bienes: base - servicios, servicios };
}

// Formato e-CF, Tabla I: 001 es la propina legal; 002 (CDT) y 005 (primera placa) son otros
// impuestos; 003 y 004 son el selectivo de seguros y telecomunicaciones, y del 006 al 039 el de
// alcoholes y tabaco. Se suman los tres montos posibles de cada impuesto: cada código usa uno.
function impuestosAdicionales(totales: Document | Element) {
  let propina = CERO;
  let otros = CERO;
  let selectivo = CERO;
  const nodos = totales.getElementsByTagName('ImpuestoAdicional');
  for (let i = 0; i < nodos.length; i++) {
    const nodo = nodos[i];
    const monto = ['MontoImpuestoSelectivoConsumoEspecifico', 'MontoImpuestoSelectivoConsumoAdvalorem', 'OtrosImpuestosAdicionales']
      .map((nombre) => centavos(texto(nodo, nombre), nombre))
      .reduce((total, parte) => total + parte, CERO);
    const tipo = Number(texto(nodo, 'TipoImpuesto'));
    if (tipo === 1) propina += monto;
    else if (tipo === 3 || tipo === 4 || (tipo >= 6 && tipo <= 39)) selectivo += monto;
    else otros += monto;
  }
  return { propina, otros, selectivo };
}

function formaDePago(documento: Document): FormaPago | undefined {
  const codigos = new Set<string>();
  const nodos = documento.getElementsByTagName('FormaPago');
  for (let i = 0; i < nodos.length; i++) codigos.add(nodos[i].textContent?.trim() ?? '');
  if (codigos.size > 1) return '7';
  if (codigos.size === 1) return FORMA_DE_PAGO_DEL_606[[...codigos][0]];
  // Sin tabla de pagos, una venta a crédito (TipoPago 2) es una compra a crédito.
  return texto(documento, 'TipoPago') === '2' ? '4' : undefined;
}

function borradorDesde(documento: Document, tipo: TipoImportable): ResultadoDeImportacion {
  const obligatorio = (nombre: string) => {
    const valor = texto(documento, nombre);
    if (valor === undefined) throw new Error(`El e-CF no trae ${nombre}.`);
    return valor;
  };
  const totales = documento.getElementsByTagName('Totales')[0] ?? documento;
  const { bienes, servicios } = bienesYServicios(documento);
  const { propina, otros, selectivo } = impuestosAdicionales(totales);
  const itbisRetenido = centavos(texto(totales, 'TotalITBISRetenido'), 'TotalITBISRetenido');
  const isrRetenido = centavos(texto(totales, 'TotalISRRetencion'), 'TotalISRRetencion');
  const forma = formaDePago(documento);

  const borrador: BorradorDeCompra = {
    RNCCedula: obligatorio('RNCEmisor'),
    NCF: obligatorio('eNCF'),
    FechaComprobante: fechaDel606(obligatorio('FechaEmision')),
    MontoServicios: aMonto(servicios),
    MontoBienes: aMonto(bienes),
    ITBISFacturado: aMonto(centavos(texto(totales, 'TotalITBIS'), 'TotalITBIS')),
  };
  if (tipo !== '31') borrador.NCFModificado = obligatorio('NCFModificado');
  if (itbisRetenido > CERO) borrador.ITBISRetenido = aMonto(itbisRetenido);
  if (isrRetenido > CERO) borrador.MontoRetencionRenta = aMonto(isrRetenido);
  if (selectivo > CERO) borrador.ImpuestoSelectivo = aMonto(selectivo);
  if (otros > CERO) borrador.OtrosImpuestos = aMonto(otros);
  if (propina > CERO) borrador.PropinaLegal = aMonto(propina);
  if (forma !== undefined) borrador.FormaPago = forma;

  const porCompletar: CampoPorCompletar[] = ['TipoBienesServicios'];
  if (forma === undefined) porCompletar.push('FormaPago');
  if (itbisRetenido > CERO || isrRetenido > CERO) porCompletar.push('FechaPago');
  if (isrRetenido > CERO) porCompletar.push('TipoRetencionISR');
  return { importado: true, borrador, porCompletar };
}

export async function importarECF(
  xml: string,
  { rncDelNegocio, validar }: DependenciasDeImportacion
): Promise<ResultadoDeImportacion> {
  const errores = (...mensajes: string[]): ResultadoDeImportacion => ({ importado: false, errores: mensajes });
  const fallar = (mensaje: string) => {
    throw new Error(mensaje);
  };
  let documento: Document;
  try {
    documento = new DOMParser({
      errorHandler: { warning: () => undefined, error: fallar, fatalError: fallar },
    }).parseFromString(xml, 'text/xml');
  } catch (error) {
    return errores(`El archivo no es un XML válido: ${(error as Error).message}`);
  }
  try {
    if (documento.documentElement?.nodeName !== 'ECF') {
      return errores('El archivo no es un e-CF: su elemento raíz no es ECF.');
    }
    const tipo = texto(documento, 'TipoeCF') ?? '';
    if (tipo === '32') return errores('Es una factura de consumo (E32): no va en el 606.');
    if (!(TIPOS_IMPORTABLES as readonly string[]).includes(tipo)) {
      return errores(`Se importan e-CF 31, 33 y 34, y este es tipo ${tipo || 'desconocido'}.`);
    }
    const validacion = await validar(xml, tipo as TipoImportable);
    if (!validacion.valido) {
      return errores(
        `El XML no valida contra el XSD de la DGII para el tipo ${tipo}.`,
        ...validacion.errores.slice(0, 5)
      );
    }
    const comprador = texto(documento, 'RNCComprador');
    if (comprador !== rncDelNegocio) {
      return errores(
        comprador === undefined
          ? 'El e-CF no identifica al comprador, y en el 606 va lo que compró este negocio.'
          : `El e-CF es para el RNC ${comprador}, no para ${rncDelNegocio}.`
      );
    }
    return borradorDesde(documento, tipo as TipoImportable);
  } catch (error) {
    return errores((error as Error).message);
  }
}
```

**Step 4: Run it to see it pass**

Run: `npx vitest run lib/compras/desdeECF.test.ts && npx tsc --noEmit`
Expected: PASS, 12 tests, no type errors. If `documento.documentElement?.nodeName` fails to type-check,
the `Document` from `@xmldom/xmldom` differs from lib.dom: use the same pattern as
`lib/ecf/representacion.ts` and cast with `as unknown as Document`.

**Step 5: Commit**

```bash
git add lib/compras/desdeECF.ts lib/compras/desdeECF.test.ts
git commit -m "feat(compras): fill a purchase from a received e-CF 31, 33 or 34"
```

---

### Task 7: Leer el formulario de compra

**Files:**
- Create: `lib/compras/formulario.ts`
- Test: `lib/compras/formulario.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { leerCompraDelFormulario } from './formulario';

function formulario(campos: Record<string, string>): FormData {
  const datos = new FormData();
  for (const [campo, valor] of Object.entries(campos)) datos.append(campo, valor);
  return datos;
}

const anotada = {
  RNCCedula: ' 987-654-321 ',
  TipoBienesServicios: '2',
  NCF: 'b0100000123',
  NCFModificado: '',
  FechaComprobante: '2026-09-05',
  FechaPago: '2026-09-20',
  MontoServicios: '1000.00',
  MontoBienes: '',
  ITBISFacturado: '180.00',
  ITBISRetenido: '54.00',
  ITBISProporcionalidad: '',
  ITBISCosto: '',
  TipoRetencionISR: '2',
  MontoRetencionRenta: '100.00',
  ImpuestoSelectivo: '',
  OtrosImpuestos: '',
  PropinaLegal: '',
  FormaPago: '2',
};

describe('leer el formulario de compra', () => {
  it('lee una compra anotada a mano', () => {
    expect(leerCompraDelFormulario(formulario(anotada))).toEqual({
      RNCCedula: '987654321',
      TipoBienesServicios: '2',
      NCF: 'B0100000123',
      FechaComprobante: '20260905',
      FechaPago: '20260920',
      MontoServicios: '1000.00',
      MontoBienes: '0',
      ITBISFacturado: '180.00',
      ITBISRetenido: '54.00',
      TipoRetencionISR: '2',
      MontoRetencionRenta: '100.00',
      FormaPago: '2',
    });
  });

  it('deja fuera los campos opcionales vacíos', () => {
    const compra = leerCompraDelFormulario(formulario({ ...anotada, FechaPago: '', ITBISRetenido: '' }));
    expect(Object.keys(compra)).not.toContain('FechaPago');
    expect(Object.keys(compra)).not.toContain('ITBISRetenido');
    expect(Object.keys(compra)).not.toContain('NCFModificado');
  });

  it('pide la fecha del comprobante', () => {
    expect(() => leerCompraDelFormulario(formulario({ ...anotada, FechaComprobante: '' }))).toThrow(
      /Falta la fecha del comprobante/
    );
  });

  it('rechaza una fecha que no viene del campo de fecha', () => {
    expect(() => leerCompraDelFormulario(formulario({ ...anotada, FechaPago: '20/09/2026' }))).toThrow(
      /Fecha de pago inválida/
    );
  });
});
```

**Step 2: Run it to see it fail**

Run: `npx vitest run lib/compras/formulario.test.ts`
Expected: FAIL with `Failed to resolve import "./formulario"`.

**Step 3: Write the implementation**

```ts
import { desdeElNavegador } from './fechas';
import type { Compra, FormaPago, TipoBienesServicios, TipoRetencionISR } from './tipos';

// Lo que recibe una Server Action es texto y puede venir de cualquiera. Aquí solo se leen los
// campos: las reglas del 606 las aplica validarCompra.

function texto(datos: FormData, nombre: string): string {
  const valor = datos.get(nombre);
  return typeof valor === 'string' ? valor.trim() : '';
}

const OPCIONALES = [
  'ITBISRetenido',
  'ITBISProporcionalidad',
  'ITBISCosto',
  'TipoRetencionISR',
  'MontoRetencionRenta',
  'ImpuestoSelectivo',
  'OtrosImpuestos',
  'PropinaLegal',
] as const;

export function leerCompraDelFormulario(datos: FormData): Compra {
  const fecha = (nombre: string, campo: string): string | undefined => {
    const valor = texto(datos, nombre);
    if (valor === '') return undefined;
    try {
      return desdeElNavegador(valor);
    } catch {
      throw new Error(`${campo} inválida: ${valor}.`);
    }
  };
  const FechaComprobante = fecha('FechaComprobante', 'Fecha del comprobante');
  if (FechaComprobante === undefined) throw new Error('Falta la fecha del comprobante.');
  // Un monto obligatorio vacío es cero.
  const monto = (nombre: string) => texto(datos, nombre) || '0';

  const compra: Compra = {
    // El RNC y la cédula se escriben con guiones; el 606 los lleva solo con dígitos.
    RNCCedula: texto(datos, 'RNCCedula').replace(/[\s-]/g, ''),
    TipoBienesServicios: texto(datos, 'TipoBienesServicios') as TipoBienesServicios,
    NCF: texto(datos, 'NCF').toUpperCase(),
    FechaComprobante,
    MontoServicios: monto('MontoServicios'),
    MontoBienes: monto('MontoBienes'),
    ITBISFacturado: monto('ITBISFacturado'),
    FormaPago: texto(datos, 'FormaPago') as FormaPago,
  };
  const NCFModificado = texto(datos, 'NCFModificado').toUpperCase();
  if (NCFModificado !== '') compra.NCFModificado = NCFModificado;
  const FechaPago = fecha('FechaPago', 'Fecha de pago');
  if (FechaPago !== undefined) compra.FechaPago = FechaPago;
  for (const campo of OPCIONALES) {
    const valor = texto(datos, campo);
    if (valor === '') continue;
    if (campo === 'TipoRetencionISR') compra.TipoRetencionISR = valor as TipoRetencionISR;
    else compra[campo] = valor;
  }
  return compra;
}
```

**Step 4: Run it to see it pass**

Run: `npx vitest run lib/compras/formulario.test.ts && npx tsc --noEmit`
Expected: PASS, 4 tests, no type errors.

**Step 5: Commit**

```bash
git add lib/compras/formulario.ts lib/compras/formulario.test.ts
git commit -m "feat(compras): read a purchase from the form"
```

---

### Task 8: Lo que dice la herramienta 606 de la DGII

This task writes no product code. It turns the open points of the design ("Lo que la norma no
fija") into facts before Tasks 9 and 11 use them.

**Decided on 2026-09-13:** Gabriel chose to go on without the tool. Steps 1–4 wait until it is at
hand, and Task 9 uses the defaults as written.

**Settled the same day from files instead of macros:** Gabriel shared three 606 and two 607 files
that DGII's tool generated and the Oficina Virtual accepted. Only their structure was read, and
none of their data is in the repository. Where they differ from the table below, they win:
- every line ends in LF, not CRLF, including the last one in the most recent files;
- the codes in fields 3 and 23 have two digits (`09`, `03`), and field 17 follows them, since
  NG 07-2018 gives all three N 2;
- an amount of zero is left empty, not written as `0.00`;
- the file name ends in `.TXT`.

The design doc's "Formato del archivo" section has the details and what is still unconfirmed.
Steps 1–4 can settle that once the tool is at hand, and so can DGII's pre-validator.

**Files:**
- Modify: `docs/plans/2026-09-13-dgii-606-design.md` (section "Datos verificados")
- Maybe modify: this plan, the code of Tasks 9 and 11, if the tool contradicts a default

**Step 1: Find the tool**

Run: `find ~/Downloads -maxdepth 3 -newermt 2026-09-13 \( -iname '*606*.xls*' -o -iname '*606*.zip' \) | grep -v DGII_F_`
Expected: the file Gabriel downloaded. If nothing shows up, stop and ask him for it; don't use the
copy in `~/Downloads/Marzo 2023-3/`, which may hold his purchases.

**Step 2: Copy it to the scratchpad**

Copy the tool into `$SCRATCHPAD/dgii-606/`, unzipping first if needed:
`unzip -o <zip> -d "$SCRATCHPAD/dgii-606"`.

**Step 3: Extract its VBA**

Save the script in Appendix A as `$SCRATCHPAD/vba.py`. It was checked against the 607 tool, and
gave 2,281 lines across 11 modules. Then run:

```bash
python3 "$SCRATCHPAD/vba.py" "$SCRATCHPAD/dgii-606/<tool>.xls" > "$SCRATCHPAD/dgii-606/606-vba.txt"
grep -n "^' =====" "$SCRATCHPAD/dgii-606/606-vba.txt"
grep -n -E 'DGII_F_606_|"606\|"|Print #1|strHeader' "$SCRATCHPAD/dgii-606/606-vba.txt"
```

Expected: module headers, including a validator class and the TXT writer.

**Step 4: Answer each question from the code**

| Question | Where to look | Default in this plan |
|---|---|---|
| Header line | `strHeader =` | `606\|RNC\|AAAAMM\|cantidad` |
| Field order | the `strDetalle = …` concatenation | NG 07-2018 Annex A (Task 11) |
| Codes in fields 3, 17 and 23 (`1` or `01`) | `Mid(`/`Format(` on those columns | unpadded: `1`–`11`, `1`–`9`, `1`–`7` |
| Amounts (decimals, padding) | `Format(`/`Trim(` on amount columns | always two decimals |
| Empty optional amounts | `Trim(` of an empty cell | empty |
| Fields 10 (total) and 15 (ITBIS por adelantar) | whether the writer writes them | written |
| End of line | `Print #1, …` and whether the last one ends with `;` | CRLF, no final newline |
| File name | `strfileName =` | `DGII_F_606_<RNC>_<AAAAMM>.txt` |
| NCF types accepted | the NCF regex in the validator class | B: 01, 03, 04, 11, 13, 14, 15, 16, 17 · E: 31, 33, 34, 41, 43, 44, 45, 46, 47 |

**Step 5: Record the answers**

1. In the design doc, under "Datos verificados", add a "Archivo del 606" bullet with what the code
   says, naming the tool's version and date.
2. Where the tool differs from a default, change the code of Tasks 9 and 11 in this plan before
   starting them, including their expected strings.

```bash
git add docs/plans
git commit -m "docs: what DGII's 606 tool writes, read from its macros"
```

---

### Task 9: NCF de compras

**Files:**
- Create: `lib/compras/ncf.ts`
- Test: `lib/compras/ncf.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { leerNCFDeCompra, tieneFormaDeNCF } from './ncf';

describe('NCF de compras', () => {
  it('acepta una factura de crédito fiscal de serie B y un e-CF', () => {
    expect(leerNCFDeCompra('B0100000123')).toEqual({ valido: true, esNota: false });
    expect(leerNCFDeCompra('E310000000456')).toEqual({ valido: true, esNota: false });
  });

  it('reconoce las notas de débito y de crédito', () => {
    for (const ncf of ['B0300000001', 'B0400000001', 'E330000000001', 'E340000000001']) {
      expect(leerNCFDeCompra(ncf)).toEqual({ valido: true, esNota: true });
    }
  });

  it('rechaza las facturas de consumo', () => {
    for (const ncf of ['B0200000001', 'E320000000001']) {
      expect(leerNCFDeCompra(ncf)).toEqual({ valido: false, motivo: expect.stringMatching(/factura de consumo/) });
    }
  });

  it('rechaza los tipos que el 606 no admite', () => {
    expect(leerNCFDeCompra('B1200000001')).toEqual({ valido: false, motivo: expect.stringMatching(/no admite/) });
    expect(leerNCFDeCompra('E990000000001')).toEqual({ valido: false, motivo: expect.stringMatching(/no admite/) });
  });

  it('rechaza lo que no tiene la forma de un NCF', () => {
    for (const ncf of ['B010000001', 'E31000000001', 'b0100000123', 'A010010010000000001', '']) {
      expect(tieneFormaDeNCF(ncf)).toBe(false);
      expect(leerNCFDeCompra(ncf)).toEqual({ valido: false, motivo: expect.stringMatching(/NCF inválido/) });
    }
  });
});
```

**Step 2: Run it to see it fail**

Run: `npx vitest run lib/compras/ncf.test.ts`
Expected: FAIL with `Failed to resolve import "./ncf"`.

**Step 3: Write the implementation**

Use the types Task 8 confirmed.

```ts
// Instructivo del 606, casilla 4: NCF de 11 posiciones (serie B) o de 13 (e-CF, Aviso 24 de abril de
// 2019). Los tipos admitidos son los de la herramienta 606 de la DGII.
const TIPOS_B: readonly string[] = ['01', '03', '04', '11', '13', '14', '15', '16', '17'];
const TIPOS_E: readonly string[] = ['31', '33', '34', '41', '43', '44', '45', '46', '47'];
const NOTAS: readonly string[] = ['B03', 'B04', 'E33', 'E34'];
// NG 06-2018: la factura de consumo es la que se emite para el consumidor final; la de crédito
// fiscal, la que tiene valor fiscal.
const CONSUMO: readonly string[] = ['B02', 'E32'];

export type LecturaDeNCF = { valido: true; esNota: boolean } | { valido: false; motivo: string };

export const tieneFormaDeNCF = (valor: string): boolean =>
  typeof valor === 'string' && /^(B\d{10}|E\d{12})$/.test(valor);

export function leerNCFDeCompra(ncf: string): LecturaDeNCF {
  if (!tieneFormaDeNCF(ncf)) {
    return {
      valido: false,
      motivo: `NCF inválido: ${ncf}. Es de serie B con 11 caracteres (B0100000001) o un e-NCF de 13 (E310000000001).`,
    };
  }
  const serieYTipo = ncf.slice(0, 3);
  if (CONSUMO.includes(serieYTipo)) {
    return { valido: false, motivo: `${ncf} es una factura de consumo: no va en el 606.` };
  }
  const tipos = ncf[0] === 'B' ? TIPOS_B : TIPOS_E;
  if (!tipos.includes(ncf.slice(1, 3))) {
    return { valido: false, motivo: `${ncf}: el 606 no admite comprobantes ${serieYTipo}.` };
  }
  return { valido: true, esNota: NOTAS.includes(serieYTipo) };
}
```

**Step 4: Run it to see it pass**

Run: `npx vitest run lib/compras/ncf.test.ts`
Expected: PASS, 5 tests.

**Step 5: Commit**

```bash
git add lib/compras/ncf.ts lib/compras/ncf.test.ts
git commit -m "feat(compras): the NCF types a 606 takes"
```

---

### Task 10: Validar una compra

**Files:**
- Create: `lib/compras/validar.ts`
- Test: `lib/compras/validar.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { compraDePrueba } from './ejemplos';
import type { FormaPago, TipoBienesServicios } from './tipos';
import { validarCompra } from './validar';

describe('validar una compra', () => {
  it('acepta una compra completa', () => {
    expect(validarCompra(compraDePrueba())).toEqual([]);
  });

  it('acepta una cédula de proveedor', () => {
    expect(validarCompra(compraDePrueba({ RNCCedula: '00100000001' }))).toEqual([]);
  });

  it('rechaza un RNC que no tiene 9 u 11 dígitos', () => {
    expect(validarCompra(compraDePrueba({ RNCCedula: '12345678' }))).toEqual([
      expect.stringMatching(/RNC o cédula del proveedor inválido.*9 u 11/),
    ]);
  });

  it('rechaza un tipo de bienes y servicios fuera del 1 al 11', () => {
    expect(validarCompra(compraDePrueba({ TipoBienesServicios: '12' as TipoBienesServicios }))).toEqual([
      expect.stringMatching(/Tipo de bienes y servicios inválido/),
    ]);
  });

  it('rechaza una factura de consumo', () => {
    expect(validarCompra(compraDePrueba({ NCF: 'B0200000001' }))).toEqual([
      expect.stringMatching(/factura de consumo/),
    ]);
  });

  it('pide el NCF modificado en una nota', () => {
    expect(validarCompra(compraDePrueba({ NCF: 'B0400000007' }))).toEqual([
      expect.stringMatching(/lleva el NCF que modifica/),
    ]);
  });

  it('acepta una nota con su NCF modificado', () => {
    expect(validarCompra(compraDePrueba({ NCF: 'E340000000007', NCFModificado: 'E310000000456' }))).toEqual([]);
  });

  it('no admite el NCF modificado fuera de una nota', () => {
    expect(validarCompra(compraDePrueba({ NCFModificado: 'B0100000001' }))).toEqual([
      expect.stringMatching(/solo en notas/),
    ]);
  });

  it('rechaza una fecha del comprobante que no existe', () => {
    expect(validarCompra(compraDePrueba({ FechaComprobante: '20260931' }))).toEqual([
      expect.stringMatching(/Fecha del comprobante inválida/),
    ]);
  });

  it('rechaza cada monto con coma o con más de dos decimales', () => {
    expect(validarCompra(compraDePrueba({ MontoServicios: '1,000.00', ITBISFacturado: '180.005' }))).toEqual([
      expect.stringMatching(/Monto facturado en servicios inválido/),
      expect.stringMatching(/ITBIS facturado inválido/),
    ]);
  });

  it('rechaza una compra sin monto', () => {
    expect(validarCompra(compraDePrueba({ MontoServicios: '0', MontoBienes: '0.00' }))).toEqual([
      expect.stringMatching(/no tiene monto/),
    ]);
  });

  it('rechaza un total que no cabe en el 606', () => {
    expect(validarCompra(compraDePrueba({ MontoServicios: '999999999.99', MontoBienes: '0.01' }))).toEqual([
      expect.stringMatching(/no cabe en el 606/),
    ]);
  });

  it('no deja que el ITBIS llevado al costo pase del facturado', () => {
    expect(validarCompra(compraDePrueba({ ITBISCosto: '180.01' }))).toEqual([
      expect.stringMatching(/llevado al costo/),
    ]);
  });

  it('pide la fecha de pago con una retención de ITBIS', () => {
    expect(validarCompra(compraDePrueba({ ITBISRetenido: '54.00' }))).toEqual([
      expect.stringMatching(/fecha de pago/),
    ]);
  });

  it('pide la fecha de pago y el tipo con una retención de ISR', () => {
    expect(validarCompra(compraDePrueba({ MontoRetencionRenta: '100.00' }))).toEqual([
      expect.stringMatching(/fecha de pago/),
      expect.stringMatching(/tipo de retención/),
    ]);
  });

  it('acepta una retención de ISR completa', () => {
    expect(
      validarCompra(compraDePrueba({ MontoRetencionRenta: '100.00', TipoRetencionISR: '2', FechaPago: '20260920' }))
    ).toEqual([]);
  });

  it('no acepta un tipo de retención sin monto retenido', () => {
    expect(validarCompra(compraDePrueba({ TipoRetencionISR: '1' }))).toEqual([
      expect.stringMatching(/va con un monto retenido/),
    ]);
  });

  it('rechaza una forma de pago fuera del 1 al 7', () => {
    expect(validarCompra(compraDePrueba({ FormaPago: '8' as FormaPago }))).toEqual([
      expect.stringMatching(/Forma de pago inválida/),
    ]);
  });
});
```

**Step 2: Run it to see it fail**

Run: `npx vitest run lib/compras/validar.test.ts`
Expected: FAIL with `Failed to resolve import "./validar"`.

**Step 3: Write the implementation**

```ts
import { tipoIdentificacion } from '../ecf/identificacion';
import { esFecha } from './fechas';
import { aCentavos, aMonto, esMonto } from './montos';
import { leerNCFDeCompra, tieneFormaDeNCF } from './ncf';
import {
  esCodigo,
  FORMAS_DE_PAGO,
  TIPOS_DE_BIENES_Y_SERVICIOS,
  TIPOS_DE_RETENCION_ISR,
  type Compra,
} from './tipos';

const CERO = BigInt(0);

// Los nombres de las casillas del instructivo, para decir en qué campo está el error.
const MONTOS = {
  MontoServicios: 'Monto facturado en servicios',
  MontoBienes: 'Monto facturado en bienes',
  ITBISFacturado: 'ITBIS facturado',
  ITBISRetenido: 'ITBIS retenido',
  ITBISProporcionalidad: 'ITBIS sujeto a proporcionalidad',
  ITBISCosto: 'ITBIS llevado al costo',
  MontoRetencionRenta: 'Monto de retención de renta',
  ImpuestoSelectivo: 'Impuesto selectivo al consumo',
  OtrosImpuestos: 'Otros impuestos o tasas',
  PropinaLegal: 'Propina legal',
} as const satisfies Partial<Record<keyof Compra, string>>;

type CampoDeMonto = keyof typeof MONTOS;

// Las reglas del instructivo del Formato de Envío 606 (febrero de 2026). Devuelve todos los
// errores y no solo el primero, para corregirlos de una vez.
export function validarCompra(compra: Compra): string[] {
  const errores: string[] = [];

  if (tipoIdentificacion(compra.RNCCedula) === null) {
    errores.push(`RNC o cédula del proveedor inválido: ${compra.RNCCedula}. Son 9 u 11 dígitos.`);
  }
  if (!esCodigo(TIPOS_DE_BIENES_Y_SERVICIOS, compra.TipoBienesServicios)) {
    errores.push(`Tipo de bienes y servicios inválido: ${compra.TipoBienesServicios}. Va del 1 al 11.`);
  }

  const ncf = leerNCFDeCompra(compra.NCF);
  if (!ncf.valido) errores.push(ncf.motivo);
  if (compra.NCFModificado !== undefined && !tieneFormaDeNCF(compra.NCFModificado)) {
    errores.push(`NCF modificado inválido: ${compra.NCFModificado}.`);
  }
  if (ncf.valido && ncf.esNota && compra.NCFModificado === undefined) {
    errores.push(`${compra.NCF} es una nota de débito o de crédito: lleva el NCF que modifica.`);
  }
  if (ncf.valido && !ncf.esNota && compra.NCFModificado !== undefined) {
    errores.push(`${compra.NCF} no es una nota: el NCF modificado va solo en notas de débito y de crédito.`);
  }

  if (!esFecha(compra.FechaComprobante)) {
    errores.push(`Fecha del comprobante inválida: ${compra.FechaComprobante}.`);
  }
  if (compra.FechaPago !== undefined && !esFecha(compra.FechaPago)) {
    errores.push(`Fecha de pago inválida: ${compra.FechaPago}.`);
  }

  const centavos: Partial<Record<CampoDeMonto, bigint>> = {};
  for (const campo of Object.keys(MONTOS) as CampoDeMonto[]) {
    const valor = compra[campo];
    if (valor === undefined) continue;
    if (esMonto(valor)) centavos[campo] = aCentavos(valor, MONTOS[campo]);
    else errores.push(`${MONTOS[campo]} inválido: ${valor}. Hasta 9 enteros y 2 decimales, con punto.`);
  }
  const monto = (campo: CampoDeMonto) => centavos[campo] ?? CERO;

  if (centavos.MontoServicios !== undefined && centavos.MontoBienes !== undefined) {
    const total = monto('MontoServicios') + monto('MontoBienes');
    if (total === CERO) errores.push('La compra no tiene monto: servicios y bienes están en cero.');
    if (aMonto(total).length > 12) {
      errores.push(`El total facturado, ${aMonto(total)}, no cabe en el 606: el máximo es 999999999.99.`);
    }
  }
  if (monto('ITBISCosto') > monto('ITBISFacturado')) {
    errores.push('El ITBIS llevado al costo no puede pasar del ITBIS facturado.');
  }
  if (monto('ITBISRetenido') > monto('ITBISFacturado')) {
    errores.push('El ITBIS retenido no puede pasar del ITBIS facturado.');
  }

  // Instructivo, casillas 12, 17 y 18: las retenciones piden la fecha de pago.
  const retieneISR = monto('MontoRetencionRenta') > CERO;
  if ((monto('ITBISRetenido') > CERO || retieneISR) && compra.FechaPago === undefined) {
    errores.push('Con retenciones, la compra lleva la fecha de pago.');
  }
  if (compra.TipoRetencionISR !== undefined && !esCodigo(TIPOS_DE_RETENCION_ISR, compra.TipoRetencionISR)) {
    errores.push(`Tipo de retención en ISR inválido: ${compra.TipoRetencionISR}. Va del 1 al 9.`);
  }
  if (retieneISR && compra.TipoRetencionISR === undefined) {
    errores.push('Con retención de ISR, la compra lleva el tipo de retención.');
  }
  if (!retieneISR && compra.TipoRetencionISR !== undefined) {
    errores.push('El tipo de retención en ISR va con un monto retenido.');
  }

  if (!esCodigo(FORMAS_DE_PAGO, compra.FormaPago)) {
    errores.push(`Forma de pago inválida: ${compra.FormaPago}. Va del 1 al 7.`);
  }
  return errores;
}
```

**Step 4: Run it to see it pass**

Run: `npx vitest run lib/compras/validar.test.ts && npx tsc --noEmit`
Expected: PASS, 18 tests, no type errors.

**Step 5: Commit**

```bash
git add lib/compras/validar.ts lib/compras/validar.test.ts
git commit -m "feat(compras): validate a purchase with the 606 rules"
```

---

### Task 11: El archivo 606

**Files:**
- Create: `lib/compras/archivo606.ts`
- Test: `lib/compras/archivo606.test.ts`

The expected bytes follow the defaults in Task 8's table. If Task 8 changed any, change them here
first.

**Changed on 2026-09-13:** Task 8 changed four defaults, so `lib/compras/archivo606.ts` and its test
differ from the code below: the name ends in `.TXT`, every line ends in LF, the codes in fields 3,
17 and 23 have two digits, and an amount of zero is left empty. The test adds a purchase with no
ITBIS.

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { archivo606, MAXIMO_DE_REGISTROS, nombreDelArchivo606 } from './archivo606';
import { compraDePrueba } from './ejemplos';

describe('el archivo 606', () => {
  it('se llama como lo nombra la herramienta de la DGII', () => {
    expect(nombreDelArchivo606('123456789', '202609')).toBe('DGII_F_606_123456789_202609.txt');
  });

  // Encabezado y 23 casillas por compra, en el orden de la NG 07-2018, Anexo A.
  it('escribe el encabezado y una línea por compra, con CRLF y sin salto final', () => {
    const nota = compraDePrueba({
      RNCCedula: '00100000001',
      TipoBienesServicios: '3',
      NCF: 'E340000000007',
      NCFModificado: 'E310000000456',
      FechaComprobante: '20260910',
      FechaPago: '20260915',
      MontoServicios: '25000',
      MontoBienes: '0',
      ITBISFacturado: '4500',
      ITBISRetenido: '4500',
      ITBISCosto: '500.5',
      TipoRetencionISR: '1',
      MontoRetencionRenta: '2500',
      OtrosImpuestos: '10',
      PropinaLegal: '2500',
      FormaPago: '2',
    });
    expect(archivo606('123456789', '202609', [compraDePrueba(), nota])).toBe(
      '606|123456789|202609|2\r\n' +
        '987654321|1|2|B0100000123||20260905||1000.00|0.00|1000.00|180.00||||180.00||||||||1\r\n' +
        '00100000001|2|3|E340000000007|E310000000456|20260910|20260915|25000.00|0.00|25000.00|4500.00|4500.00||500.50|3999.50||1|2500.00|||10.00|2500.00|2'
    );
  });

  it('rechaza un mes sin compras', () => {
    expect(() => archivo606('123456789', '202609', [])).toThrow(/en cero/);
  });

  it('rechaza más compras de las que admite un archivo', () => {
    const compras = Array.from({ length: MAXIMO_DE_REGISTROS + 1 }, () => compraDePrueba());
    expect(() => archivo606('123456789', '202609', compras)).toThrow(/hasta 10000/);
  });

  it('rechaza un periodo inválido', () => {
    expect(() => archivo606('123456789', '2026-09', [compraDePrueba()])).toThrow(/Periodo inválido/);
  });
});
```

**Step 2: Run it to see it fail**

Run: `npx vitest run lib/compras/archivo606.test.ts`
Expected: FAIL with `Failed to resolve import "./archivo606"`.

**Step 3: Write the implementation**

```ts
import { tipoIdentificacion } from '../ecf/identificacion';
import { esPeriodo } from './fechas';
import { aCentavos, aMonto } from './montos';
import type { Compra } from './tipos';

// Instructivo del 606: hasta 10,000 registros por archivo.
export const MAXIMO_DE_REGISTROS = 10_000;

// Como escribe la herramienta 606 de la DGII: líneas separadas por CRLF y sin salto después de la
// última.
const FIN_DE_LINEA = '\r\n';

const CERO = BigInt(0);

export const nombreDelArchivo606 = (rnc: string, periodo: string): string =>
  `DGII_F_606_${rnc}_${periodo}.txt`;

const opcional = (valor: string | undefined, campo: string) =>
  valor === undefined ? '' : aMonto(aCentavos(valor, campo));

// Las 23 casillas en el orden de la NG 07-2018, Anexo A, separadas por barra vertical.
function detalle(compra: Compra): string {
  const servicios = aCentavos(compra.MontoServicios, 'Monto facturado en servicios');
  const bienes = aCentavos(compra.MontoBienes, 'Monto facturado en bienes');
  const itbis = aCentavos(compra.ITBISFacturado, 'ITBIS facturado');
  const alCosto =
    compra.ITBISCosto === undefined ? CERO : aCentavos(compra.ITBISCosto, 'ITBIS llevado al costo');
  return [
    compra.RNCCedula,
    tipoIdentificacion(compra.RNCCedula) === 'RNC' ? '1' : '2',
    compra.TipoBienesServicios,
    compra.NCF,
    compra.NCFModificado ?? '',
    compra.FechaComprobante,
    compra.FechaPago ?? '',
    aMonto(servicios),
    aMonto(bienes),
    aMonto(servicios + bienes),
    aMonto(itbis),
    opcional(compra.ITBISRetenido, 'ITBIS retenido'),
    opcional(compra.ITBISProporcionalidad, 'ITBIS sujeto a proporcionalidad'),
    opcional(compra.ITBISCosto, 'ITBIS llevado al costo'),
    aMonto(itbis - alCosto),
    // ITBIS percibido en compras: la DGII no lo tiene habilitado.
    '',
    compra.TipoRetencionISR ?? '',
    opcional(compra.MontoRetencionRenta, 'Monto de retención de renta'),
    // ISR percibido en compras: tampoco.
    '',
    opcional(compra.ImpuestoSelectivo, 'Impuesto selectivo al consumo'),
    opcional(compra.OtrosImpuestos, 'Otros impuestos o tasas'),
    opcional(compra.PropinaLegal, 'Propina legal'),
    compra.FormaPago,
  ].join('|');
}

// El archivo que se sube a la Oficina Virtual. Las compras llegan validadas y ya elegidas para el
// periodo: aquí solo se escribe.
export function archivo606(rnc: string, periodo: string, compras: Compra[]): string {
  if (tipoIdentificacion(rnc) === null) throw new Error(`RNC o cédula del emisor inválido: ${rnc}.`);
  if (!esPeriodo(periodo)) throw new Error(`Periodo inválido: ${periodo}. Formato AAAAMM, desde 201805.`);
  if (compras.length === 0) {
    throw new Error('Un mes sin compras no lleva archivo: el 606 se presenta en cero en la Oficina Virtual.');
  }
  if (compras.length > MAXIMO_DE_REGISTROS) {
    throw new Error(
      `El 606 admite hasta ${MAXIMO_DE_REGISTROS} compras por archivo, y este mes tiene ${compras.length}.`
    );
  }
  return [`606|${rnc}|${periodo}|${compras.length}`, ...compras.map(detalle)].join(FIN_DE_LINEA);
}
```

**Step 4: Run it to see it pass**

Run: `npx vitest run lib/compras/archivo606.test.ts`
Expected: PASS, 5 tests.

**Step 5: Commit**

```bash
git add lib/compras/archivo606.ts lib/compras/archivo606.test.ts
git commit -m "feat(compras): write the 606 file the Oficina Virtual takes"
```

---

### Task 12: Acciones de compras

**Files:**
- Create: `app/compras/acciones.ts`
- Test: `app/compras/acciones.test.ts`

**Changed on 2026-09-13:** with Task 11's format, the demo file is
`DGII_F_606_000000000_202609.TXT`, and the test compares its whole content, which ends in LF.

**Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { crearCredencialDeDemostracion } from '@/lib/credencial';
import { emitirECF } from '@/lib/emitir';
import { leerEsquema } from '@/lib/esquemas';
import { CLAVE_DEL_PROCESO, EMISOR_DE_DEMOSTRACION } from '@/lib/storage';
import { emisorDePrueba } from '@/lib/storage/contrato';
import { AlmacenamientoEnMemoria } from '@/lib/storage/memoria';
import { borrarCompra, generar606, guardarCompra, importarXML } from './acciones';

// refresh() solo existe dentro de Next.
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

function formulario(campos: Record<string, string>): FormData {
  const datos = new FormData();
  for (const [campo, valor] of Object.entries(campos)) datos.append(campo, valor);
  return datos;
}

const anotada = {
  RNCCedula: '987-654-321',
  TipoBienesServicios: '2',
  NCF: 'B0100000123',
  FechaComprobante: '2026-09-05',
  MontoServicios: '1000.00',
  MontoBienes: '',
  ITBISFacturado: '180.00',
  FormaPago: '1',
};

// Un e-CF 31 que emisorDePrueba le vende al negocio de la demostración.
async function ecfParaLaDemostracion(): Promise<string> {
  const resultado = await emitirECF(
    {
      tipo: '31',
      IndicadorMontoGravado: 0,
      TipoIngresos: '01',
      TipoPago: 1,
      Comprador: { RNCComprador: EMISOR_DE_DEMOSTRACION.RNCEmisor, RazonSocialComprador: 'Negocio de demostración' },
      Items: [{ NombreItem: 'Resma de papel', IndicadorBienoServicio: 1, CantidadItem: '2', PrecioUnitarioItem: '250.00', IndicadorFacturacion: 1 }],
    },
    {
      almacenamiento: new AlmacenamientoEnMemoria(emisorDePrueba()),
      credencial: () => crearCredencialDeDemostracion(),
      leerEsquema,
      ahora: () => new Date('2026-09-12T14:30:00Z'),
    }
  );
  if (!resultado.emitido) throw new Error(resultado.errores.join(' '));
  return resultado.xml;
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as Record<string, unknown>)[CLAVE_DEL_PROCESO];
});

describe('acciones de compras', () => {
  it('guarda una compra anotada a mano y la lleva al 606 del mes', async () => {
    vi.stubEnv('VERCEL', '1');
    expect(await guardarCompra(formulario(anotada))).toEqual({ guardado: true, clave: '987654321_B0100000123' });
    const resultado = await generar606('202609');
    expect(resultado).toMatchObject({ generado: true, nombre: 'DGII_F_606_000000000_202609.txt' });
    if (!resultado.generado) return;
    expect(resultado.contenido.split('\r\n')).toEqual([
      '606|000000000|202609|1',
      '987654321|1|2|B0100000123||20260905||1000.00|0.00|1000.00|180.00||||180.00||||||||1',
    ]);
  });

  it('no guarda una compra con errores', async () => {
    vi.stubEnv('VERCEL', '1');
    expect(await guardarCompra(formulario({ ...anotada, NCF: 'B0200000001' }))).toEqual({
      guardado: false,
      errores: [expect.stringMatching(/factura de consumo/)],
    });
    expect(await generar606('202609')).toEqual({
      generado: false,
      errores: [expect.stringMatching(/en cero/)],
    });
  });

  it('corrige una compra sin dejar cambiar el proveedor ni el NCF', async () => {
    vi.stubEnv('VERCEL', '1');
    await guardarCompra(formulario(anotada));
    const claveOriginal = '987654321_B0100000123';
    expect(await guardarCompra(formulario({ ...anotada, NCF: 'B0100000124', claveOriginal }))).toEqual({
      guardado: false,
      errores: [expect.stringMatching(/borra la compra/)],
    });
    expect(await guardarCompra(formulario({ ...anotada, MontoServicios: '2000.00', claveOriginal }))).toEqual({
      guardado: true,
      clave: claveOriginal,
    });
    expect(await generar606('202609')).toMatchObject({ contenido: expect.stringContaining('|2000.00|') });
  });

  it('borra una compra', async () => {
    vi.stubEnv('VERCEL', '1');
    await guardarCompra(formulario(anotada));
    expect(await borrarCompra('987654321_B0100000123')).toEqual({ borrado: true });
    expect(await generar606('202609')).toMatchObject({ generado: false });
  });

  it('importa el XML de un e-CF y lo guarda con la compra', async () => {
    vi.stubEnv('VERCEL', '1');
    const xml = await ecfParaLaDemostracion();
    expect(await importarXML(formulario({ xml }))).toMatchObject({
      importado: true,
      borrador: { RNCCedula: '123456789', NCF: 'E310000000001', MontoBienes: '500.00' },
      porCompletar: ['TipoBienesServicios', 'FormaPago'],
      xml,
    });
    const completada = {
      RNCCedula: '123456789',
      TipoBienesServicios: '9',
      NCF: 'E310000000001',
      FechaComprobante: '2026-09-12',
      MontoServicios: '0.00',
      MontoBienes: '500.00',
      ITBISFacturado: '90.00',
      FormaPago: '1',
    };
    expect(await guardarCompra(formulario({ ...completada, xml }))).toEqual({
      guardado: true,
      clave: '123456789_E310000000001',
    });
    expect(await importarXML(formulario({ xml }))).toEqual({
      importado: false,
      errores: [expect.stringMatching(/ya está anotada/)],
    });
  });

  it('no guarda un XML que no es de la compra', async () => {
    vi.stubEnv('VERCEL', '1');
    const xml = await ecfParaLaDemostracion();
    expect(await guardarCompra(formulario({ ...anotada, xml }))).toEqual({
      guardado: false,
      errores: [expect.stringMatching(/no es de esta compra/)],
    });
  });
});
```

**Step 2: Run it to see it fail**

Run: `npx vitest run app/compras/acciones.test.ts`
Expected: FAIL with `Failed to resolve import "./acciones"`.

**Step 3: Write the implementation**

```ts
'use server';

import { refresh } from 'next/cache';
import { archivo606, nombreDelArchivo606 } from '@/lib/compras/archivo606';
import { importarECF, type ResultadoDeImportacion } from '@/lib/compras/desdeECF';
import { esPeriodo } from '@/lib/compras/fechas';
import { leerCompraDelFormulario } from '@/lib/compras/formulario';
import { comprasDelPeriodo } from '@/lib/compras/periodo';
import { claveDeCompra } from '@/lib/compras/tipos';
import { validarCompra } from '@/lib/compras/validar';
import { validarContraXSD } from '@/lib/ecf/validar';
import { leerEsquema } from '@/lib/esquemas';
import { obtenerAlmacenamiento } from '@/lib/storage';

export type ResultadoDeGuardar =
  | { guardado: true; clave: string }
  | { guardado: false; errores: string[] };
export type ResultadoDeImportar = ResultadoDeImportacion & { xml?: string };
export type ResultadoDeBorrar = { borrado: true } | { borrado: false; errores: string[] };
export type ResultadoDel606 =
  | { generado: true; nombre: string; contenido: string }
  | { generado: false; errores: string[] };

// Un e-CF pesa unos kilobytes: un archivo de más de un megabyte no es uno.
const TAMANO_MAXIMO_DEL_XML = 1_000_000;

const mensaje = (error: unknown) => (error as Error).message;

async function dependenciasDeImportacion() {
  const { RNCEmisor } = await obtenerAlmacenamiento().leerEmisor();
  return {
    rncDelNegocio: RNCEmisor,
    validar: (xml: string, tipo: string) => validarContraXSD(xml, leerEsquema(tipo)),
  };
}

export async function importarXML(datos: FormData): Promise<ResultadoDeImportar> {
  try {
    const archivo = datos.get('xml');
    const xml = archivo === null ? '' : typeof archivo === 'string' ? archivo : await archivo.text();
    if (xml === '') return { importado: false, errores: ['Elige el XML de un e-CF.'] };
    if (xml.length > TAMANO_MAXIMO_DEL_XML) {
      return { importado: false, errores: ['El archivo es demasiado grande para ser un e-CF.'] };
    }
    const resultado = await importarECF(xml, await dependenciasDeImportacion());
    if (!resultado.importado) return resultado;
    const clave = claveDeCompra(resultado.borrador);
    const anotadas = await obtenerAlmacenamiento().listarCompras();
    if (anotadas.some((compra) => claveDeCompra(compra) === clave)) {
      return {
        importado: false,
        errores: [`${resultado.borrador.NCF} de ${resultado.borrador.RNCCedula} ya está anotada.`],
      };
    }
    return { ...resultado, xml };
  } catch (error) {
    return { importado: false, errores: [mensaje(error)] };
  }
}

export async function guardarCompra(datos: FormData): Promise<ResultadoDeGuardar> {
  try {
    const compra = leerCompraDelFormulario(datos);
    const errores = validarCompra(compra);
    if (errores.length > 0) return { guardado: false, errores };
    const almacenamiento = obtenerAlmacenamiento();
    const clave = claveDeCompra(compra);

    const original = datos.get('claveOriginal');
    if (typeof original === 'string' && original !== '') {
      if (original !== clave) {
        return {
          guardado: false,
          errores: ['Al corregir no se cambian el proveedor ni el NCF: borra la compra y anótala de nuevo.'],
        };
      }
      await almacenamiento.reemplazarCompra(compra);
    } else {
      const xml = datos.get('xml');
      if (typeof xml === 'string' && xml !== '') {
        // El XML vuelve del navegador: se revisa otra vez y tiene que ser el de esta compra.
        const importacion = await importarECF(xml, await dependenciasDeImportacion());
        if (!importacion.importado) return { guardado: false, errores: importacion.errores };
        if (claveDeCompra(importacion.borrador) !== clave) {
          return {
            guardado: false,
            errores: ['El XML no es de esta compra: el proveedor o el NCF no coinciden.'],
          };
        }
        await almacenamiento.guardarCompra(compra, xml);
      } else {
        await almacenamiento.guardarCompra(compra);
      }
    }
    refresh();
    return { guardado: true, clave };
  } catch (error) {
    return { guardado: false, errores: [mensaje(error)] };
  }
}

export async function borrarCompra(clave: string): Promise<ResultadoDeBorrar> {
  try {
    await obtenerAlmacenamiento().borrarCompra(clave);
    refresh();
    return { borrado: true };
  } catch (error) {
    return { borrado: false, errores: [mensaje(error)] };
  }
}

// En Vercel una ruta de descarga correría en otra función, sin la memoria donde viven las
// compras: el archivo sale en la respuesta de la acción, y así en los dos modos.
export async function generar606(periodo: string): Promise<ResultadoDel606> {
  try {
    if (!esPeriodo(periodo)) return { generado: false, errores: [`Periodo inválido: ${periodo}.`] };
    const almacenamiento = obtenerAlmacenamiento();
    const { RNCEmisor } = await almacenamiento.leerEmisor();
    const lineas = comprasDelPeriodo(await almacenamiento.listarCompras(), periodo);
    if (lineas.length === 0) {
      return {
        generado: false,
        errores: ['No hay compras en este mes. El 606 de un mes sin compras se presenta en cero en la Oficina Virtual.'],
      };
    }
    // Como la herramienta de la DGII: con una sola compra con errores no hay archivo.
    const errores = lineas.flatMap((linea) =>
      validarCompra(linea).map((error) => `${linea.NCF} de ${linea.RNCCedula}: ${error}`)
    );
    if (errores.length > 0) return { generado: false, errores };
    return {
      generado: true,
      nombre: nombreDelArchivo606(RNCEmisor, periodo),
      contenido: archivo606(RNCEmisor, periodo, lineas),
    };
  } catch (error) {
    return { generado: false, errores: [mensaje(error)] };
  }
}
```

**Step 4: Run it to see it pass**

Run: `npx vitest run app/compras/acciones.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS, 6 tests, no type or lint errors.

**Step 5: Commit**

```bash
git add app/compras/acciones.ts app/compras/acciones.test.ts
git commit -m "feat(app): server actions to record purchases and generate the 606"
```

---

### Task 13: Partes compartidas y navegación

A behavior-preserving refactor, plus a link between the two pages.

**Files:**
- Create: `app/partes.tsx` (`Titulo` and `Campo`, moved out of `app/emision.tsx`)
- Create: `app/membrete.tsx` (the page header with navigation, and `AvisoDeModo` moved out of `app/page.tsx`)
- Modify: `app/emision.tsx`, `app/page.tsx`, `app/pagina.module.css`
- Modify (untracked, not in git): `~/Desktop/Proyectos/invoice-generator/.claude/launch.json`

**Step 1: Create `app/partes.tsx`**

```tsx
import type { ReactNode } from 'react';
import estilos from './emision.module.css';

// Piezas de formulario que comparten la página de emitir y la de compras.

export function Titulo({
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

// codigo es el nombre del campo en el documento de la DGII: el elemento del XSD en un e-CF, la
// casilla en el 606.
export function Campo({
  id,
  etiqueta,
  codigo,
  ayuda,
  children,
}: {
  id: string;
  etiqueta: string;
  codigo: string;
  ayuda?: string;
  children: ReactNode;
}) {
  return (
    <div className={estilos.campo}>
      <label htmlFor={id} className={estilos.etiqueta}>
        {etiqueta}
        <span className={estilos.xsd} aria-hidden="true">
          {codigo}
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
```

**Step 2: Use it from `app/emision.tsx`**

- Delete the local `function Titulo` and `function Campo`.
- Add `import { Campo, Titulo } from './partes';`.
- Rename the prop `xsd=` to `codigo=` in the five `<Campo>` uses: `tipo-ingresos`, `tipo-pago`,
  `rnc-comprador`, `razon-social` and `fecha-limite-pago`.
- Leave `type ReactNode` in the React import: `Formulario` still uses it.

**Step 3: Create `app/membrete.tsx`**

```tsx
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Modo } from '@/lib/storage';
import estilos from './pagina.module.css';

const SECCIONES = [
  { ruta: '/', nombre: 'Emitir e-CF' },
  { ruta: '/compras', nombre: 'Compras y 606' },
] as const;

export function Membrete({
  actual,
  antetitulo,
  modo,
  children,
}: {
  actual: (typeof SECCIONES)[number]['ruta'];
  antetitulo: string;
  modo: Modo;
  children: ReactNode;
}) {
  return (
    <header className={estilos.membrete}>
      <div>
        <nav aria-label="Secciones" className={estilos.navegacion}>
          {SECCIONES.map(({ ruta, nombre }) => (
            <Link
              key={ruta}
              href={ruta}
              aria-current={ruta === actual ? 'page' : undefined}
              className={estilos.seccionDeNavegacion}
            >
              {nombre}
            </Link>
          ))}
        </nav>
        <p className={estilos.antetitulo}>{antetitulo}</p>
        <h1 className={estilos.titulo}>{children}</h1>
      </div>
      <AvisoDeModo modo={modo} />
    </header>
  );
}
```

Then move `function AvisoDeModo` from `app/page.tsx` below `Membrete`, unchanged.

**Step 4: Use it from `app/page.tsx`**

Replace the `<header className={estilos.membrete}>…</header>` block with:

```tsx
      <Membrete actual="/" antetitulo="Comprobante fiscal electrónico" modo={modo}>
        Emitir <em>e-CF</em>
      </Membrete>
```

Add `import { Membrete } from './membrete';` and delete the local `AvisoDeModo`.

**Step 5: Style the navigation in `app/pagina.module.css`**

Append:

```css
.navegacion {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1.4rem;
  margin: 0 0 1.1rem;
  font-family: var(--fuente-cifras), ui-monospace, monospace;
  font-size: 0.74rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.seccionDeNavegacion {
  padding-bottom: 0.15rem;
  border-bottom: 2px solid transparent;
  color: var(--tinta-suave);
  text-decoration: none;
}

.seccionDeNavegacion:hover {
  color: var(--tinta);
}

.seccionDeNavegacion[aria-current='page'] {
  border-bottom-color: var(--azul);
  color: var(--azul);
}
```

**Step 6: Add dev servers for this worktree**

Add these two entries to the `configurations` in
`~/Desktop/Proyectos/invoice-generator/.claude/launch.json`:

```json
    {
      "name": "ecf-606-local",
      "runtimeExecutable": "/bin/zsh",
      "runtimeArgs": [
        "-c",
        "export PATH=\"$HOME/.nvm/versions/node/v22.23.1/bin:$PATH\" && cd \"$HOME/.config/superpowers/worktrees/invoice-generator/dgii-606\" && exec npm run dev -- -p 3104"
      ],
      "port": 3104
    },
    {
      "name": "ecf-606-demostracion",
      "runtimeExecutable": "/bin/zsh",
      "runtimeArgs": [
        "-c",
        "export PATH=\"$HOME/.nvm/versions/node/v22.23.1/bin:$PATH\" && cd \"$HOME/.config/superpowers/worktrees/invoice-generator/dgii-606\" && export VERCEL=1 && exec npm run dev -- -p 3105"
      ],
      "port": 3105
    }
```

**Step 7: Verify**

Run: `npm test && npx next typegen && npx tsc --noEmit && npm run lint`
Expected: every test passes (none of them changed), with no type or lint errors.

Start `ecf-606-demostracion`, open `http://localhost:3105/` and check:
- the page looks as before;
- the navigation shows "Emitir e-CF" underlined;
- "Compras y 606" leads to a 404, because the page doesn't exist yet.

**Step 8: Commit**

```bash
git add app/partes.tsx app/membrete.tsx app/emision.tsx app/page.tsx app/pagina.module.css
git commit -m "refactor(app): share form parts and the page header, with navigation"
```

---

### Task 14: Página de compras: el mes, la lista y el 606

**Files:**
- Create: `app/compras/page.tsx`
- Create: `app/compras/compras.tsx`
- Create: `app/compras/compras.module.css`

**Step 1: Create `app/compras/page.tsx`**

```tsx
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
  const periodo = typeof pedido === 'string' && esPeriodo(pedido) ? pedido : periodoEnRD(new Date());
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
```

**Step 2: Create `app/compras/compras.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { startTransition, useActionState, type ReactNode } from 'react';
import { esPeriodo, nombreDelPeriodo, periodoAnterior, periodoSiguiente } from '@/lib/compras/fechas';
import { aCentavos, aMonto } from '@/lib/compras/montos';
import { claveDeCompra, FORMAS_DE_PAGO, type Compra } from '@/lib/compras/tipos';
import { conMiles } from '@/lib/formato';
import emision from '../emision.module.css';
import { Titulo } from '../partes';
import { generar606, type ResultadoDel606 } from './acciones';
import estilos from './compras.module.css';

const fechaLegible = (fecha: string) => `${fecha.slice(6, 8)}/${fecha.slice(4, 6)}/${fecha.slice(0, 4)}`;

// Lo guardado puede venir editado a mano en datos/: si no es un monto, se muestra tal cual.
function montoLegible(...valores: string[]): string {
  try {
    return conMiles(aMonto(valores.reduce((total, valor) => total + aCentavos(valor, 'Monto'), BigInt(0))));
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
    return <p className={emision.ayuda}>No hay compras anotadas en {nombreDelPeriodo(periodo)}.</p>;
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
                <td className={emision.monto}>{montoLegible(compra.MontoServicios, compra.MontoBienes)}</td>
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
  const [resultado, accion, generando] = useActionState<ResultadoDel606 | null, void>(async () => {
    const nuevo = await generar606(periodo);
    if (nuevo.generado) bajar(nuevo.nombre, nuevo.contenido);
    return nuevo;
  }, null);

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
```

**Step 3: Create `app/compras/compras.module.css`**

```css
.compras {
  display: grid;
  gap: clamp(2.2rem, 5vw, 3.5rem);
  margin-top: clamp(1.8rem, 4vw, 3rem);
}

.periodo {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.6rem 1.5rem;
  font-family: var(--fuente-cifras), ui-monospace, monospace;
  font-size: 0.82rem;
}

.periodo a {
  color: var(--azul);
}

.mes {
  margin: 0;
  font-family: var(--fuente-titulares), Georgia, serif;
  font-size: clamp(1.6rem, 3.5vw, 2.2rem);
}

.mes::first-letter {
  text-transform: uppercase;
}

.reenvio {
  display: block;
  margin-top: 0.2rem;
  font-family: var(--fuente-texto), system-ui, sans-serif;
  font-size: 0.75rem;
  color: var(--tinta-suave);
}

.acciones {
  white-space: nowrap;
}

.acciones button {
  margin-left: 0.7rem;
  padding: 0;
  border: 0;
  background: none;
  color: var(--azul);
  font: inherit;
  font-size: 0.85rem;
  text-decoration: underline;
  cursor: pointer;
}

.acciones button:disabled {
  color: var(--tinta-tenue);
  cursor: not-allowed;
}
```

**Step 4: Verify**

Run: `npx next typegen && npx tsc --noEmit && npm run lint && npm test`
Expected: no type or lint errors, and every test passes.

Start `ecf-606-demostracion` and open `http://localhost:3105/compras`. Check:
- the current month shows, with links to the previous and next months;
- "No hay compras anotadas" appears;
- the 606 section says a month without purchases is filed in zero;
- the header navigation marks "Compras y 606".

For local mode, write a fictitious `datos/emisor.json` in the worktree (git ignores `datos/`), using
the example in `app/page.tsx` with RNC `123456789`. Start `ecf-606-local`, open
`http://localhost:3104/compras` and check the same things.

**Step 5: Commit**

```bash
git add app/compras/page.tsx app/compras/compras.tsx app/compras/compras.module.css
git commit -m "feat(app): purchases page with the month, the list and the 606 download"
```

---

### Task 15: Anotar, corregir y borrar

**Files:**
- Modify: `app/compras/compras.tsx`
- Modify: `app/compras/compras.module.css`

**Step 1: Add the form and the row actions to `app/compras/compras.tsx`**

Update the imports:

```tsx
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
  type ResultadoDeGuardar,
  type ResultadoDel606,
} from './acciones';
import estilos from './compras.module.css';
```

Replace `export function Compras` with:

```tsx
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
          nota={edicion.clave ? `Corrigiendo ${edicion.inicial.NCF} de ${edicion.inicial.RNCCedula}.` : undefined}
        >
          {edicion.clave ? 'Corregir una compra' : 'Anotar una compra'}
        </Titulo>
        {aviso && (
          <p className={estilos.aviso} aria-live="polite">
            {aviso}
          </p>
        )}
        <FormularioDeCompra
          key={formularios}
          {...edicion}
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
```

Add these components below `Lista`:

```tsx
function AccionesDeCompra({ compra, alCorregir }: { compra: Compra; alCorregir: () => void }) {
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const borrar = async () => {
    if (!window.confirm(`¿Borrar ${compra.NCF} de ${compra.RNCCedula}? No se puede deshacer.`)) return;
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

const MONTO = '\\d{1,9}(\\.\\d{1,2})?';

type ValoresDelFormulario = Partial<Record<keyof Compra, string>>;

const MAS_CAMPOS = [
  ['ITBISRetenido', 'ITBIS retenido', 'Casilla 12', 'Pide la fecha de pago.'],
  ['ITBISProporcionalidad', 'ITBIS sujeto a proporcionalidad', 'Casilla 13', 'Artículo 349 del Código Tributario.'],
  ['ITBISCosto', 'ITBIS llevado al costo', 'Casilla 14', 'No puede pasar del ITBIS facturado.'],
  ['MontoRetencionRenta', 'Retención de ISR', 'Casilla 18', 'Pide la fecha de pago y el tipo de retención.'],
  ['ImpuestoSelectivo', 'Impuesto selectivo al consumo', 'Casilla 20', undefined],
  ['OtrosImpuestos', 'Otros impuestos o tasas', 'Casilla 21', undefined],
  ['PropinaLegal', 'Propina legal', 'Casilla 22', undefined],
] as const;

function FormularioDeCompra({
  clave,
  inicial,
  xml,
  porCompletar = [],
  alGuardar,
  alCancelar,
}: Edicion & { alGuardar: (clave: string) => void; alCancelar?: () => void }) {
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
  const conMasCampos = MAS_CAMPOS.some(([campo]) => valores[campo]) || porCompletar.includes('TipoRetencionISR');
  const entrada = emision.entrada;
  const cifra = `${emision.entrada} ${emision.cifra}`;

  return (
    <form
      // Con <form action>, React reinicia el formulario al terminar la acción (ver app/emision.tsx).
      onSubmit={(evento) => {
        evento.preventDefault();
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
            ayuda={llaveFija ? 'No se cambia: con otro proveedor, es otra compra.' : '9 u 11 dígitos. Los guiones se quitan al guardar.'}
          >
            <input id="rnc-proveedor" name="RNCCedula" defaultValue={valores.RNCCedula} readOnly={llaveFija} required inputMode="numeric" autoComplete="off" aria-describedby="rnc-proveedor-ayuda" className={cifra} />
          </Campo>
          <Campo id="ncf" etiqueta="NCF" codigo="Casilla 4" ayuda={llaveFija ? 'No se cambia: con otro NCF, es otra compra.' : 'Serie B de 11 caracteres o e-NCF de 13.'}>
            <input id="ncf" name="NCF" defaultValue={valores.NCF} readOnly={llaveFija} required maxLength={13} autoComplete="off" aria-describedby="ncf-ayuda" className={cifra} />
          </Campo>
          <Campo id="ncf-modificado" etiqueta="NCF modificado" codigo="Casilla 5" ayuda="Solo en notas de débito y de crédito.">
            <input id="ncf-modificado" name="NCFModificado" defaultValue={valores.NCFModificado} maxLength={13} autoComplete="off" aria-describedby="ncf-modificado-ayuda" className={cifra} />
          </Campo>
          <Campo id="fecha-comprobante" etiqueta="Fecha del comprobante" codigo="Casilla 6">
            <input id="fecha-comprobante" type="date" name="FechaComprobante" defaultValue={valores.FechaComprobante} required className={entrada} />
          </Campo>
          <Campo id="fecha-pago" etiqueta="Fecha de pago" codigo="Casilla 7" ayuda={falta('FechaPago', 'Si ya se pagó. Con retenciones es obligatoria.')}>
            <input id="fecha-pago" type="date" name="FechaPago" defaultValue={valores.FechaPago} aria-describedby="fecha-pago-ayuda" className={entrada} />
          </Campo>
          <Campo id="tipo-bienes" etiqueta="Tipo de bienes y servicios" codigo="Casilla 3" ayuda={falta('TipoBienesServicios', 'Cómo se usa lo comprado.')}>
            <select id="tipo-bienes" name="TipoBienesServicios" defaultValue={valores.TipoBienesServicios ?? ''} required aria-describedby="tipo-bienes-ayuda" className={entrada}>
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
          <Campo id="forma-pago" etiqueta="Forma de pago" codigo="Casilla 23" ayuda={falta('FormaPago', 'Mixto si se pagó de varias formas.')}>
            <select id="forma-pago" name="FormaPago" defaultValue={valores.FormaPago ?? ''} required aria-describedby="forma-pago-ayuda" className={entrada}>
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
          <Campo id="monto-servicios" etiqueta="Monto en servicios" codigo="Casilla 8" ayuda="Sin impuestos.">
            <input id="monto-servicios" name="MontoServicios" defaultValue={valores.MontoServicios} inputMode="decimal" pattern={MONTO} placeholder="0.00" aria-describedby="monto-servicios-ayuda" className={`${cifra} ${emision.derecha}`} />
          </Campo>
          <Campo id="monto-bienes" etiqueta="Monto en bienes" codigo="Casilla 9" ayuda="Sin impuestos.">
            <input id="monto-bienes" name="MontoBienes" defaultValue={valores.MontoBienes} inputMode="decimal" pattern={MONTO} placeholder="0.00" aria-describedby="monto-bienes-ayuda" className={`${cifra} ${emision.derecha}`} />
          </Campo>
          <Campo id="itbis-facturado" etiqueta="ITBIS facturado" codigo="Casilla 11" ayuda="El ITBIS del comprobante.">
            <input id="itbis-facturado" name="ITBISFacturado" defaultValue={valores.ITBISFacturado} inputMode="decimal" pattern={MONTO} placeholder="0.00" aria-describedby="itbis-facturado-ayuda" className={`${cifra} ${emision.derecha}`} />
          </Campo>
        </div>
        <details className={estilos.masCampos} open={conMasCampos}>
          <summary>Retenciones, proporcionalidad y otros impuestos</summary>
          <div className={emision.campos}>
            {MAS_CAMPOS.map(([campo, etiqueta, codigo, ayuda]) => {
              const id = `campo-${campo}`;
              return (
                <Campo key={campo} id={id} etiqueta={etiqueta} codigo={codigo} ayuda={ayuda}>
                  <input id={id} name={campo} defaultValue={valores[campo]} inputMode="decimal" pattern={MONTO} placeholder="—" aria-describedby={ayuda ? `${id}-ayuda` : undefined} className={`${cifra} ${emision.derecha}`} />
                </Campo>
              );
            })}
            <Campo id="tipo-retencion" etiqueta="Tipo de retención en ISR" codigo="Casilla 17" ayuda={falta('TipoRetencionISR', 'Solo con retención de ISR.')}>
              <select id="tipo-retencion" name="TipoRetencionISR" defaultValue={valores.TipoRetencionISR ?? ''} aria-describedby="tipo-retencion-ayuda" className={entrada}>
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
```

Format the file with Prettier's settings (`npx prettier --write app/compras/compras.tsx`) if the
long JSX lines above bother the linter. Prettier is a dev dependency of `eslint-config-next`; if
it isn't installed, break the lines by hand in the style of `app/emision.tsx`.

**Step 2: Add the styles to `app/compras/compras.module.css`**

```css
.aviso {
  margin: 0 0 1rem;
  padding: 0.7rem 1rem;
  border-left: 4px solid var(--verde);
  background: rgb(46 107 61 / 0.07);
}

.masCampos {
  margin-top: 1.4rem;
}

.masCampos summary {
  margin-bottom: 1rem;
  color: var(--azul);
  font-weight: 700;
  cursor: pointer;
}

.botones {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
  margin: 1.6rem 0 1rem;
}

.secundario {
  padding: 0.6rem 1rem;
  border: 1px solid var(--linea);
  border-radius: 3px;
  background: var(--papel-claro);
  color: var(--tinta);
  font: inherit;
  cursor: pointer;
}

.error {
  display: block;
  margin-top: 0.3rem;
  font-size: 0.8rem;
  color: var(--sello);
  white-space: normal;
}
```

**Step 3: Verify**

Run: `npx next typegen && npx tsc --noEmit && npm run lint && npm test`
Expected: no type or lint errors, and every test passes.

In `ecf-606-demostracion` (`http://localhost:3105/compras?periodo=202609`):
1. Save a purchase: RNC `987-654-321`, NCF `B0100000123`, date 05/09/2026, type 2, cash,
   1000.00 in services and 180.00 of ITBIS. The notice "Guardada" appears, and the purchase is in
   the list.
2. Save it again. You get the duplicate error.
3. Correct it: 2000.00 in services. The RNC and NCF are read-only, and the list shows 2,000.00.
4. Delete it after confirming. The list is empty.
5. Save one with ITBIS retained 54.00 and no payment date. You get the payment-date error.

**Step 4: Commit**

```bash
git add app/compras/compras.tsx app/compras/compras.module.css
git commit -m "feat(app): record, correct and delete purchases"
```

---

### Task 16: Subir el XML

**Files:**
- Modify: `app/compras/compras.tsx`
- Modify: `app/compras/compras.module.css`

**Step 1: Add the import form**

Add `importarXML` and `type ResultadoDeImportar` to the import from `./acciones`. Add this
component below `AccionesDeCompra`:

```tsx
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
```

In `Compras`, render it right after the `aviso` paragraph and before `<FormularioDeCompra`, only
while not correcting:

```tsx
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
```

**Step 2: Add the styles**

```css
.importar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.8rem 1.2rem;
  margin-bottom: 1.6rem;
  padding: 1rem 1.2rem;
  border: 1px dashed var(--linea);
  background: var(--papel-claro);
}

.resultadoDeImportar {
  flex-basis: 100%;
}
```

**Step 3: Verify**

Run: `npx next typegen && npx tsc --noEmit && npm run lint && npm test`
Expected: no type or lint errors, and every test passes.

Make a test XML with the `ecfParaLaDemostracion` fixture from Task 12:
1. Temporarily add `writeFileSync('/tmp/ecf-demo.xml', xml)` inside that test.
2. Run the test.
3. Remove the line again, and don't commit it.

Then, in `ecf-606-demostracion`:
1. Upload `/tmp/ecf-demo.xml`. The form fills with RNC 123456789, NCF E310000000001 and
   500.00 in goods, and marks the type and the payment method as to complete.
2. Complete them and save. The purchase is in September 2026.
3. Upload the same XML again. It says "ya está anotada".
4. Upload a non-XML file. It says the file isn't a valid XML or an e-CF.

**Step 4: Commit**

```bash
git add app/compras/compras.tsx app/compras/compras.module.css
git commit -m "feat(app): fill a purchase from a received e-CF XML"
```

---

### Task 17: README y cierre

**Files:**
- Modify: `README.md`

**Step 1: Document the feature**

In the first paragraph, after "…with DGII's verification QR.", add:

> It also records purchases, typed in or imported from a supplier's e-CF XML, and writes the monthly
> 606 file for DGII's Oficina Virtual.

After "How it works", add:

````markdown
## Purchases and the 606

- `/compras` lists a month's purchases. Each one is saved as `datos/compras/<RNC>_<NCF>.json`,
  with the supplier's XML next to it when it was imported. Supplier and NCF are the key, so the
  same NCF can't be recorded twice.
- A received e-CF 31, 33 or 34 fills the form. The XML has to validate against DGII's XSD and be
  addressed to your RNC. What it doesn't say (the type of goods and services, and sometimes the
  payment method) you complete.
- A month's 606 holds that month's invoices. It also holds earlier invoices paid this month with a
  retention, sent again with their original date, as DGII's instructions ask. If any purchase in
  the month has an error, the app writes no file and says what to fix.
- The file follows DGII's Excel tool, read from its macros: `606|RNC|AAAAMM|count` and 23 fields
  per line. What only DGII can check (active supplier, authorized NCF, accepted e-CF) shows up when
  it processes the upload.
- There's no 607: DGII doesn't take e-CF in it (e-CF FAQ, question 1.4.13).
````

In "Layout", add `lib/compras/     purchases: amounts, dates, validation, the 606 file, e-CF import`.

**Step 2: Full verification**

Run: `npm test && npx next typegen && npx tsc --noEmit && npm run lint && npm run build`
Expected: every test passes, and there are no type or lint errors. The build lists `/compras` as a
dynamic route.

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: purchases and the 606 in the README"
```

**Step 4: Finish the branch**

Use superpowers:finishing-a-development-branch. Push and PR were agreed with Gabriel: the PR goes
on top of `dgii-ecf` (PR #7), with base `dgii-ecf`. Ask before pushing anyway, and include no Claude
attribution in the PR.

---

## Appendix A: `vba.py`

The script checked against the 607 tool. It extracts the VBA of an Excel 97-2003 file with no
dependencies.

```python
#!/usr/bin/env python3
"""Extrae el código VBA de un .xls (Excel 97-2003) sin dependencias.

Uso: python3 vba.py <archivo.xls> > macros.txt

Lee el Compound File Binary (MS-CFB), busca el storage VBA, lee el stream dir
comprimido (MS-OVBA 2.3.4.2) para saber dónde empieza el código de cada módulo y
descomprime cada uno (MS-OVBA 2.4.1).
"""
import struct
import sys

FIN_DE_CADENA = 0xFFFFFFFE
LIBRE = 0xFFFFFFFF


def leer_cfb(datos):
    if datos[:8] != bytes.fromhex('D0CF11E0A1B11AE1'):
        raise SystemExit('No es un Compound File Binary')
    version = struct.unpack_from('<H', datos, 0x1A)[0]
    tam_sector = 1 << struct.unpack_from('<H', datos, 0x1E)[0]
    tam_mini = 1 << struct.unpack_from('<H', datos, 0x20)[0]
    primer_dir = struct.unpack_from('<I', datos, 0x30)[0]
    corte_mini = struct.unpack_from('<I', datos, 0x38)[0]
    primer_minifat = struct.unpack_from('<I', datos, 0x3C)[0]
    primer_difat = struct.unpack_from('<I', datos, 0x44)[0]
    difat = list(struct.unpack_from('<109I', datos, 0x4C))
    por_sector = tam_sector // 4

    def sector(n):
        inicio = (n + 1) * tam_sector
        return datos[inicio:inicio + tam_sector]

    siguiente = primer_difat
    while siguiente not in (FIN_DE_CADENA, LIBRE):
        valores = struct.unpack_from('<%dI' % por_sector, sector(siguiente))
        difat.extend(valores[:-1])
        siguiente = valores[-1]

    fat = []
    for n in difat:
        if n not in (FIN_DE_CADENA, LIBRE):
            fat.extend(struct.unpack_from('<%dI' % por_sector, sector(n)))

    def cadena(inicio, tabla):
        n, visto = inicio, set()
        while n not in (FIN_DE_CADENA, LIBRE) and n < len(tabla) and n not in visto:
            visto.add(n)
            yield n
            n = tabla[n]

    def leer_grande(inicio):
        return b''.join(sector(n) for n in cadena(inicio, fat))

    directorio = leer_grande(primer_dir)
    entradas = []
    for i in range(len(directorio) // 128):
        e = directorio[i * 128:(i + 1) * 128]
        largo = struct.unpack_from('<H', e, 64)[0]
        izq, der, hijo = struct.unpack_from('<III', e, 68)
        tam = struct.unpack_from('<I' if version == 3 else '<Q', e, 120)[0]
        entradas.append({
            'nombre': e[:max(largo - 2, 0)].decode('utf-16-le', 'replace'),
            'tipo': e[66],
            'izq': izq,
            'der': der,
            'hijo': hijo,
            'inicio': struct.unpack_from('<I', e, 116)[0],
            'tam': tam,
        })

    mini_stream = leer_grande(entradas[0]['inicio'])
    minifat = []
    for n in cadena(primer_minifat, fat):
        minifat.extend(struct.unpack_from('<%dI' % por_sector, sector(n)))

    def leer(entrada):
        if entrada['tam'] < corte_mini:
            partes = [mini_stream[n * tam_mini:(n + 1) * tam_mini] for n in cadena(entrada['inicio'], minifat)]
            return b''.join(partes)[:entrada['tam']]
        return leer_grande(entrada['inicio'])[:entrada['tam']]

    def hijos(indice):
        # Los hijos de un storage forman un árbol rojo-negro que cuelga de 'hijo'.
        resultado, pila = [], [entradas[indice]['hijo']]
        while pila:
            n = pila.pop()
            if n == LIBRE or n >= len(entradas):
                continue
            resultado.append(n)
            pila.extend([entradas[n]['izq'], entradas[n]['der']])
        return resultado

    return entradas, hijos, leer


def descomprimir(contenedor):
    # MS-OVBA 2.4.1: un byte de firma y bloques de hasta 4096 bytes descomprimidos.
    if not contenedor or contenedor[0] != 1:
        raise ValueError('Contenedor comprimido sin firma 0x01')
    salida, pos = bytearray(), 1
    while pos + 2 <= len(contenedor):
        cabecera = struct.unpack_from('<H', contenedor, pos)[0]
        fin_bloque = min(pos + (cabecera & 0x0FFF) + 3, len(contenedor))
        comprimido = cabecera & 0x8000
        pos += 2
        inicio_bloque = len(salida)
        if not comprimido:
            salida.extend(contenedor[pos:pos + 4096])
            pos += 4096
            continue
        while pos < fin_bloque:
            banderas = contenedor[pos]
            pos += 1
            for bit in range(8):
                if pos >= fin_bloque:
                    break
                if not (banderas >> bit) & 1:
                    salida.append(contenedor[pos])
                    pos += 1
                    continue
                token = struct.unpack_from('<H', contenedor, pos)[0]
                pos += 2
                bits = max((len(salida) - inicio_bloque - 1).bit_length(), 4)
                largo = (token & (0xFFFF >> bits)) + 3
                desplazamiento = (token >> (16 - bits)) + 1
                for _ in range(largo):
                    salida.append(salida[-desplazamiento])
    return bytes(salida)


def desplazamientos_de_modulos(dir_descomprimido):
    # MS-OVBA 2.3.4.2: registros (id, tamaño, datos). PROJECTVERSION declara 4 y trae 6.
    pos, nombre, resultado = 0, None, {}
    while pos + 6 <= len(dir_descomprimido):
        ident, tam = struct.unpack_from('<HI', dir_descomprimido, pos)
        pos += 6
        if ident == 0x0009:
            tam = 6
        valor = dir_descomprimido[pos:pos + tam]
        pos += tam
        if ident == 0x001A:
            nombre = valor.decode('latin-1')
        elif ident == 0x0031 and nombre is not None:
            resultado[nombre] = struct.unpack_from('<I', valor)[0]
    return resultado


def main():
    with open(sys.argv[1], 'rb') as archivo:
        datos = archivo.read()
    entradas, hijos, leer = leer_cfb(datos)
    vba = next((i for i, e in enumerate(entradas) if e['nombre'] == 'VBA' and e['tipo'] == 1), None)
    if vba is None:
        raise SystemExit('El archivo no tiene proyecto VBA')
    por_nombre = {entradas[i]['nombre']: entradas[i] for i in hijos(vba)}
    desplazamientos = desplazamientos_de_modulos(descomprimir(leer(por_nombre['dir'])))
    for nombre, desplazamiento in desplazamientos.items():
        entrada = por_nombre.get(nombre)
        if entrada is None:
            continue
        codigo = descomprimir(leer(entrada)[desplazamiento:])
        print("' ===== %s =====" % nombre)
        print(codigo.decode('cp1252', 'replace'))


if __name__ == '__main__':
    main()
```

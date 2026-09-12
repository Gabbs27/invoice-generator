# DGII e-CF Issuer — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn `Gabbs27/invoice-generator` into a self-hosted issuer of Dominican electronic fiscal receipts that generates, signs and validates e-CF XML, exports 606/607, and never transmits in v1.

**Architecture:** Next.js, one codebase in two modes. Locally the folder `./datos/` is the database and holds the `.p12`; on Vercel storage is in-memory and signing is disabled. The fiscal engine lives in `lib/ecf/` as pure TypeScript with no I/O, so it is testable without a browser, a certificate or a disk. Writing the signed XML with the `wx` flag is what makes a duplicate e-NCF impossible.

**Tech Stack:** Next.js 15, TypeScript, Vitest, `@react-pdf/renderer` (kept from the current app), `xmllint-wasm` for XSD validation, `node-forge` + `xadesjs` for XAdES-BES.

**Design:** `docs/plans/2026-09-12-dgii-ecf-design.md`

---

## Ground rules for whoever executes this

1. **Every guard gets checked in both directions, in the same sitting.** Red on the broken state, green on the fixed one. A test you have only ever seen pass is a test you cannot trust.
2. **Never invent a fiscal rule.** If a rate, a field name or an algorithm is not in a DGII document or a verified source, stop and ask. A wrong invoice is a legal problem, not a bug.
3. **Commit after each task.**

---

## Task 0 — XSD schemas (DONE)

The fifteen schemas are in `esquemas/`, each with its sha256, size, URL and DGII
publication date in `esquemas/MANIFIESTO.json`.

This task was first written as manual, on the belief that DGII blocked scripted
downloads. It does not: the portal answers 403 to curl's and fetch's User-Agent
and 200 to a browser's. `scripts/bajar-esquemas.mjs` downloads with browser
headers and, without `--actualizar`, exits 1 when DGII has changed a schema since
the manifest was written — or when a local XSD no longer matches it.

**Before every release:** `node scripts/bajar-esquemas.mjs`. Types 33 and 34
changed on 2026-04-01, six months after the rest; a validator running against a
stale XSD passes XML that DGII rejects.

**Filenames are DGII's own, with spaces and no consistent pattern**
(`e-CF 31 v.1.0.xsd`, `ARECF v1.0.xsd`, `ANECF v.1.0.xsd`). Resolve a document
type to its file through the manifest's `tipo` field; never build the name by
concatenating strings.

---

## Phase 1 — Scaffold

### Task 1: Replace Create React App with Next.js

`react-scripts` is discontinued. The history stays; the toolchain does not.

**Files:**
- Delete: `src/`, `public/`, `config-overrides.js` if present
- Modify: `package.json`
- Create: `next.config.ts`, `tsconfig.json`, `vitest.config.ts`, `app/layout.tsx`, `app/page.tsx`

**Step 1: Record what the current app is, before deleting it**

```bash
git rm -r --cached src public
mkdir -p docs
git log --oneline > docs/historia-cra.txt
```

**Step 2: Scaffold Next.js in place**

```bash
npx create-next-app@latest . --typescript --app --no-tailwind --no-src-dir --import-alias "@/*"
```

Answer *yes* to overwriting. Then reinstall the one dependency worth keeping:

```bash
npm install @react-pdf/renderer
npm install -D vitest @vitest/coverage-v8
```

**Step 3: Wire the test script**

In `package.json`:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

**Step 4: Verify**

Run: `npm run build && npm test`
Expected: the build succeeds; vitest reports no test files, which is correct at this point.

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: replace Create React App with Next.js"
```

---

## Phase 2 — The engine

Pure TypeScript. No `fs`, no `fetch`, no React in any file under `lib/ecf/`.

### Task 2: Document types

**Files:**
- Create: `lib/ecf/tipos.ts`
- Test: `lib/ecf/tipos.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { TIPOS_ECF, nombreTipo, esTipoValido } from './tipos';

describe('tipos de e-CF', () => {
  it('conoce los diez tipos publicados por DGII', () => {
    expect(Object.keys(TIPOS_ECF)).toEqual(
      ['31', '32', '33', '34', '41', '43', '44', '45', '46', '47']
    );
  });

  it('nombra el tipo 31 como Factura de Crédito Fiscal Electrónica', () => {
    expect(nombreTipo('31')).toBe('Factura de Crédito Fiscal Electrónica');
  });

  it('rechaza un tipo que no existe', () => {
    expect(esTipoValido('99')).toBe(false);
  });
});
```

**Step 2: Run it and watch it fail**

Run: `npx vitest run lib/ecf/tipos.test.ts`
Expected: FAIL — cannot resolve `./tipos`.

**Step 3: Implement**

```ts
export const TIPOS_ECF = {
  '31': 'Factura de Crédito Fiscal Electrónica',
  '32': 'Factura de Consumo Electrónica',
  '33': 'Nota de Débito Electrónica',
  '34': 'Nota de Crédito Electrónica',
  '41': 'Comprobante Electrónico de Compras',
  '43': 'Comprobante Electrónico para Gastos Menores',
  '44': 'Comprobante Electrónico para Regímenes Especiales',
  '45': 'Comprobante Electrónico Gubernamental',
  '46': 'Comprobante Electrónico para Exportaciones',
  '47': 'Comprobante Electrónico para Pagos al Exterior',
} as const;

export type TipoECF = keyof typeof TIPOS_ECF;

export const esTipoValido = (t: string): t is TipoECF => t in TIPOS_ECF;
export const nombreTipo = (t: TipoECF): string => TIPOS_ECF[t];
```

**Step 4: Verify** — Run the test. Expected: PASS.

**Step 5: Commit**

```bash
git add lib/ecf/tipos.ts lib/ecf/tipos.test.ts
git commit -m "feat(ecf): the ten DGII document types"
```

---

### Task 3: e-NCF format

13 characters: `E` + two-digit type + ten-digit sequence.

**Files:**
- Create: `lib/ecf/encf.ts`
- Test: `lib/ecf/encf.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { construirENCF, parsearENCF, esENCFValido } from './encf';

describe('e-NCF', () => {
  it('construye trece caracteres: E, tipo, secuencia en diez dígitos', () => {
    const encf = construirENCF('31', 1);
    expect(encf).toBe('E310000000001');
    expect(encf).toHaveLength(13);
  });

  it('no trunca una secuencia de diez dígitos', () => {
    expect(construirENCF('32', 9_999_999_999)).toBe('E329999999999');
  });

  it('rechaza una secuencia que no cabe en diez dígitos', () => {
    expect(() => construirENCF('31', 10_000_000_000)).toThrow(/diez dígitos/);
  });

  it('rechaza la secuencia cero: DGII numera desde 1', () => {
    expect(() => construirENCF('31', 0)).toThrow();
  });

  it('parsea de vuelta al tipo y la secuencia', () => {
    expect(parsearENCF('E340000012345')).toEqual({ tipo: '34', secuencia: 12345 });
  });

  // El control negativo: lo que NO es un e-NCF.
  it.each([
    ['B0100000001', 'un NCF viejo de once caracteres'],
    ['E31000000001', 'doce caracteres'],
    ['E3100000000012', 'catorce caracteres'],
    ['X310000000001', 'no empieza con E'],
    ['E990000000001', 'tipo inexistente'],
    ['E31000000000A', 'secuencia no numérica'],
  ])('rechaza %s (%s)', (valor) => {
    expect(esENCFValido(valor)).toBe(false);
  });
});
```

**Step 2: Run it and watch it fail.**

**Step 3: Implement**

```ts
import { esTipoValido, type TipoECF } from './tipos';

const LARGO_SECUENCIA = 10;
export const MAX_SECUENCIA = 10 ** LARGO_SECUENCIA - 1;

export function construirENCF(tipo: TipoECF, secuencia: number): string {
  if (!Number.isInteger(secuencia) || secuencia < 1) {
    throw new Error(`Secuencia inválida: ${secuencia}. DGII numera desde 1.`);
  }
  if (secuencia > MAX_SECUENCIA) {
    throw new Error(
      `La secuencia ${secuencia} no cabe en diez dígitos (máximo ${MAX_SECUENCIA}).`
    );
  }
  return `E${tipo}${String(secuencia).padStart(LARGO_SECUENCIA, '0')}`;
}

export function esENCFValido(valor: string): boolean {
  if (typeof valor !== 'string' || valor.length !== 13) return false;
  if (valor[0] !== 'E') return false;
  const tipo = valor.slice(1, 3);
  if (!esTipoValido(tipo)) return false;
  return /^\d{10}$/.test(valor.slice(3));
}

export function parsearENCF(valor: string): { tipo: TipoECF; secuencia: number } {
  if (!esENCFValido(valor)) throw new Error(`e-NCF inválido: ${valor}`);
  return {
    tipo: valor.slice(1, 3) as TipoECF,
    secuencia: Number(valor.slice(3)),
  };
}
```

**Step 4: Verify** — PASS.

**Step 5: Commit**

```bash
git commit -am "feat(ecf): e-NCF construction, parsing and validation"
```

---

### Task 4: RNC and cédula check digits

**STOP AND VERIFY BEFORE WRITING THE ALGORITHM.**

The weighted-sum algorithm for the RNC check digit is widely published but is not
in a DGII document I have verified. Before implementing:

1. Collect at least five real RNCs from invoices Gabriel already has, plus five
   cédulas, and write them into the test as known-valid fixtures.
2. Implement the algorithm.
3. If any known-valid number fails, the algorithm is wrong — not the number.
   Ask before adjusting.

**Files:**
- Create: `lib/ecf/identificacion.ts`
- Test: `lib/ecf/identificacion.test.ts`

The test must contain both directions: known-valid numbers that pass, and the
same numbers with one digit changed, which must fail. A validator that accepts
everything passes a test that only ever feeds it valid input.

**Commit:** `feat(ecf): RNC and cédula validation`

---

### Task 5: ITBIS and totals

**Files:**
- Create: `lib/ecf/calculo.ts`
- Test: `lib/ecf/calculo.test.ts`

Rules to encode, each with its own test:

- The general ITBIS rate is 18%. It is a parameter, not a literal buried in the
  code, because rates change by law and by product category.
- Rounding is to two decimals, and the test must include a case where per-line
  rounding and total rounding disagree — that difference is a real category of
  invoice dispute, and the plan is to round at the line and sum the rounded
  values.
- Exempt lines contribute to the subtotal and not to the tax.
- A credit note (type 34) carries the same arithmetic with reversed sign.

**Do not add retenciones until there is a verified rule for them.** Leave the
field out rather than guess a percentage.

**Commit:** `feat(ecf): ITBIS and totals`

---

### Task 6: XML construction

**Files:**
- Create: `lib/ecf/xml.ts`
- Test: `lib/ecf/xml.test.ts`

Build the XML for a type 31 and a type 32 from a typed invoice object. Field
names come from the XSD committed in Task 0, not from memory.

**Commit:** `feat(ecf): e-CF XML construction`

---

### Task 7: XSD validation

**Files:**
- Create: `lib/ecf/validar.ts`
- Test: `lib/ecf/validar.test.ts`

**Step 1: Install a validator with no native build**

```bash
npm install -D xmllint-wasm
```

`libxmljs2` is the usual choice and needs native compilation, which breaks on
Vercel. WASM does not.

**Step 2: The test has to fail on bad XML, and that is the whole point**

```ts
it('acepta un e-CF bien formado', async () => {
  const resultado = await validarContraXSD(xmlValido, '31');
  expect(resultado.valido).toBe(true);
});

it('rechaza un e-CF al que le falta el e-NCF', async () => {
  const resultado = await validarContraXSD(xmlSinENCF, '31');
  expect(resultado.valido).toBe(false);
  expect(resultado.errores.join(' ')).toMatch(/eNCF/i);
});

// Control: el validador tiene que poder distinguir algo.
it('rechaza XML que no es un e-CF en absoluto', async () => {
  const resultado = await validarContraXSD('<hola/>', '31');
  expect(resultado.valido).toBe(false);
});
```

That third test is the one that matters. A validator wired to the wrong schema
path, or one that swallows its own errors, returns `true` for everything — and a
check that always passes looks exactly like a check that passes.

**Commit:** `feat(ecf): validate the XML against DGII's XSD`

---

### Task 8: XAdES-BES signature — spike first

**This task starts with a spike, not with code.** The library APIs here are not
something to assume.

**Step 1: Spike**

Create a scratch script that:
1. Generates a self-signed `.p12` with `openssl` for testing.
2. Reads it with `node-forge` and extracts the private key and certificate.
3. Signs a small XML with `xadesjs` + `@peculiar/webcrypto`.
4. Verifies the signature back.

If any step does not work, report it before going further. Do not proceed on a
signature that has never been verified.

**Step 2 onward:** wrap what the spike proved into `lib/ecf/firma.ts`, with the
private key passed in, never read from disk inside the engine.

**Commit:** `feat(ecf): XAdES-BES signing`

---

## Phase 3 — Storage

### Task 9: The Storage interface and the in-memory implementation

**Files:**
- Create: `lib/storage/tipos.ts`, `lib/storage/memoria.ts`
- Test: `lib/storage/memoria.test.ts`

```ts
export interface Almacenamiento {
  leerEmisor(): Promise<Emisor>;
  proximaSecuencia(tipo: TipoECF): Promise<number>;
  guardarComprobante(encf: string, xml: string): Promise<void>;
  listarComprobantes(tipo?: TipoECF): Promise<string[]>;
}
```

`guardarComprobante` must reject a duplicate e-NCF. In memory that is a `Map`
check; on disk it is the filesystem. Both implementations share the same test
suite, so the behaviour cannot drift between them.

**Commit:** `feat(storage): interface and in-memory implementation`

---

### Task 10: File storage, and the uniqueness constraint

**Files:**
- Create: `lib/storage/archivos.ts`
- Test: `lib/storage/archivos.test.ts`

**Step 1: Write the tests that matter**

```ts
it('rechaza un e-NCF duplicado con EEXIST', async () => {
  await almacen.guardarComprobante('E310000000001', '<a/>');
  await expect(
    almacen.guardarComprobante('E310000000001', '<b/>')
  ).rejects.toThrow(/EEXIST|duplicad/i);
});

it('no sobrescribe el XML original cuando rechaza el duplicado', async () => {
  await almacen.guardarComprobante('E310000000001', '<original/>');
  await almacen.guardarComprobante('E310000000001', '<otro/>').catch(() => {});
  const guardado = readFileSync(`${dir}/facturas/E310000000001.xml`, 'utf8');
  expect(guardado).toBe('<original/>');
});

it('deriva la próxima secuencia del directorio, no del contador', async () => {
  await almacen.guardarComprobante('E310000000007', '<a/>');
  rmSync(`${dir}/secuencias.json`, { force: true });   // se pierde la caché
  expect(await almacen.proximaSecuencia('31')).toBe(8);
});

it('se niega a emitir pasado el rango autorizado', async () => {
  // emisor.json autoriza 31 hasta la secuencia 3
  await almacen.guardarComprobante('E310000000003', '<a/>');
  await expect(almacen.proximaSecuencia('31')).rejects.toThrow(/rango/i);
});
```

**Step 2: Implement with `wx`**

```ts
import { writeFileSync } from 'node:fs';

writeFileSync(ruta, xml, { flag: 'wx' });
```

**Step 3: Prove the guard goes red.** Temporarily change `wx` to `w`, run the
duplicate tests, confirm they fail, put `wx` back, confirm they pass. Both
directions, same sitting.

**Commit:** `feat(storage): the folder is the database, and the filesystem is the unique index`

---

### Task 11: Pick the implementation by environment

**Files:**
- Create: `lib/storage/index.ts`

On Vercel (`process.env.VERCEL`) the filesystem is ephemeral, so file storage
would appear to work and lose everything. Choose in-memory there, and make the
demo say so on screen.

**Commit:** `feat(storage): file storage locally, memory on Vercel`

---

## Phase 4 — The application

### Task 12: Issue an invoice

The form, the engine call, the save. The invoice is written only after the XML
validates — an invalid comprobante must never consume a sequence number.

**Commit:** `feat(app): issue an e-CF`

### Task 13: Printed representation

`@react-pdf/renderer`, carrying the e-NCF, the issuer's RNC, the totals and a QR
code. **Verify what the QR must contain before generating one** — it encodes a
DGII verification URL whose exact shape is in the technical documentation.

**Commit:** `feat(app): printed representation`

### Task 14: 606 / 607 export

**Commit:** `feat(app): 606 and 607 reports`

### Task 15: Say plainly what this is not

A visible notice, in the app: this instance does not transmit to DGII, and using
it does not make anyone compliant. Plus the requirements that do: RNC, Alta
e-NCF, digital certificate, DGII certification.

**Commit:** `feat(app): state what the tool does not do`

---

## Phase 5 — Ship it

### Task 16: Deploy to Vercel

Connect the repo, deploy, confirm the demo runs in memory mode and that signing
is visibly disabled.

### Task 17: Update the portfolio

In the **other** repo, `sanity-react`:

- `src/config/projects.json`: change the invoice-generator entry's `url` from
  `https://gabbs27.github.io/invoice-generator/` to the Vercel URL, and rewrite
  the description — it currently says "simplifies invoicing process for
  businesses", which will no longer be what this is.
- Take a fresh screenshot, run `bash scripts/optimize-images.sh`, replace
  `/images/invoice_generator.webp`.
- The projects test asserts every project appears in the home page's noscript;
  run `npm test` there.

### Task 18: Retire GitHub Pages

Turn off Pages for the repo so two versions of the app do not answer at two URLs.

---

## Out of scope for v1, on purpose

- Transmission to DGII, in any environment.
- Multi-tenant anything.
- Retenciones, until there is a verified rule.
- The "my react calendar" cleanup — a separate job, tracked separately.

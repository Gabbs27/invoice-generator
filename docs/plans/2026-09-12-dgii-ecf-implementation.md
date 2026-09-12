# DGII e-CF Issuer — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn `Gabbs27/invoice-generator` into a self-hosted issuer of Dominican electronic fiscal receipts that generates, signs and validates e-CF XML, exports 606/607, and never transmits in v1.

**Architecture:** Next.js, one codebase in two modes. Locally the folder `./datos/` is the database and holds the `.p12`; on Vercel storage is in-memory and signing uses a demonstration certificate generated in memory. The fiscal engine lives in `lib/ecf/` as pure TypeScript with no I/O, so it is testable without a browser, a certificate or a disk. Writing the signed XML with the `wx` flag is what makes a duplicate e-NCF impossible.

**Tech Stack:** Next.js 16, TypeScript, Vitest, `@react-pdf/renderer` (kept from the current app), `xmllint-wasm` for XSD validation, `node-forge` to read the `.p12`, and the XMLDSig library the Task 8 spike picks.

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

### Task 4: RNC and cédula format

**Decided on 2026-09-12: format only, no check digit.** None of the DGII
documents in `esquemas/docs/` defines a check-digit algorithm for the RNC or the
cédula. What DGII does publish is the XSD's `RNCValidationType`,
`[0-9]{11}|[0-9]{9}`, and that is what gets validated: nine digits is an RNC,
eleven is a cédula.

The weighted-sum algorithm that circulates online is not a DGII publication. It
can come back as a warning that never blocks issuing, once there is a DGII
source or a set of real RNCs to check it against. Real people's cédulas do not
go into the fixtures of a public repo.

**Files:**
- Create: `lib/ecf/identificacion.ts`
- Test: `lib/ecf/identificacion.test.ts`

The test covers both directions: nine and eleven digits pass; every other length,
dashes, surrounding whitespace and letters fail. A validator that accepts
everything fails the second half, and one that rejects everything fails the
first.

**Commit:** `feat(ecf): RNC and cédula format`

---

### Task 5: ITBIS and totals

**Rewritten on 2026-09-12 against DGII's documents.** The first version rounded
each line and summed, and reversed the sign on credit notes. DGII does neither.
Page numbers are the printed ones in `esquemas/docs/Formato-e-CF-v1.0.pdf` (F)
and `esquemas/docs/Informe-Tecnico-e-CF-v1.0.pdf` (IT).

**Files:**
- Create: `lib/ecf/calculo.ts`
- Test: `lib/ecf/calculo.test.ts`

Rules to encode, each with its own test:

- **MontoItem** = (PrecioUnitarioItem × CantidadItem) − DescuentoMonto +
  RecargoMonto (F p.44). The price has up to 4 decimals; the quantity up to 2 and
  is greater than zero; every amount has 2 (XSD).
- **Rounding:** two decimals; a third decimal of 5 or more raises the second
  (IT p.22, with DGII's examples 750.5212 → 750.52 and 750.5276 → 750.53). It
  applies to every amount of 16 integer digits and 2 decimals (F p.18, note 11).
  Compute in integers, not floats: `1.005 * 100` is `100.49999999999999` in
  JavaScript.
- **ITBIS is computed on the taxed total of each rate, not per line.**
  MontoGravadoI1 is the sum of MontoItem with IndicadorFacturacion 1, and
  TotalITBIS1 = MontoGravadoI1 × ITBIS1; the same for rates 2 and 3
  (F pp.19–21). Items carry no ITBIS amount. The test includes lines whose
  per-line ITBIS would add up to a different number.
- **Indicators** (F p.36): 1 = ITBIS1, 2 = ITBIS2, 3 = ITBIS3, 4 = exento.
  Exempt items go to MontoExento and never to the tax.
- **Rates are a parameter.** The XML declares them in ITBIS1–3 as integers of
  one or two digits (XSD); the Formato describes them as 18, 16 and 0
  (F pp.20–21).
- **Prices with ITBIS included** (IndicadorMontoGravado = 1, F p.7): the taxed
  amount is the sum divided by (1 + rate) (F p.19). Exempt items are not
  divided. The total can end up a cent above what was charged; DGII tolerates a
  global difference of one unit per detail line (IT p.21).
- **MontoGravadoTotal** = I1 + I2 + I3 (F p.18); **MontoTotal** =
  MontoGravadoTotal + MontoExento + TotalITBIS (F p.25). The fields of a rate no
  item uses are left out: DGII marks them conditional.
- **Credit notes (type 34)** use the same arithmetic with positive amounts; the
  type-34 XSD does not accept negative totals. The note's MontoTotal cannot
  exceed the modified e-CF's total, counting earlier notes against it (F p.25,
  note 30).

**Not in v1, by decision or for lack of a verified rule:**

- Global discounts and surcharges. With them, the Formato gives two readings of
  when to divide by (1 + rate) (F p.19); without them, both agree.
- IndicadorFacturacion 0 (no facturable).
- Additional taxes: ISC and the rest (F pp.21–25, IT pp.22–30).
- Retenciones: the fields exist (F p.36); the percentages are in no document.
- A credit note issued more than 30 days after the obligation arose restores
  the price without the ITBIS (IT p.17; IndicadorNotaCredito, F p.7). The
  documents do not say how that changes the note's totals. Ask before encoding
  it.

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
- Create: `lib/ecf/validar.ts` — pure: takes the XML and the schema's text
- Create: `lib/esquemas.ts` — outside the engine: reads a schema by `tipo`
  through `esquemas/MANIFIESTO.json` and checks its sha256
- Test: `lib/ecf/validar.test.ts`, `lib/esquemas.test.ts`

**Step 1: Install a validator with no native build**

```bash
npm install xmllint-wasm
```

A runtime dependency, not a dev one: the app validates every comprobante before
saving it. `libxmljs2` is the usual choice and needs native compilation, which
breaks on Vercel. WASM does not.

**DGII's e-CF 31 schema does not compile.** It references
`IndicadorServicioTodoIncluidoType` and never defines it. The 33, 34, 44 and 45
schemas define it identically; the 32 differs only in whitespace. Decided with
Gabriel on 2026-09-12: the committed file stays byte-for-byte what DGII
publishes, and `validar.ts` adds that one definition in memory when a schema
uses the type without defining it. Three tests keep the patch honest:

- the added definition is the one in `e-CF 33 v.1.0.xsd`, byte for byte;
- a schema that already defines the type comes back untouched;
- the published e-CF 31 schema, unpatched, still fails to compile. The day DGII
  fixes it, that test goes red and the patch comes out.

**Step 2: The test has to fail on bad XML, and that is the whole point**

```ts
it('acepta un e-CF bien formado', async () => {
  const resultado = await validarContraXSD(xmlValido, esquema31);
  expect(resultado.valido).toBe(true);
});

it('rechaza un e-CF al que le falta el e-NCF', async () => {
  const resultado = await validarContraXSD(xmlSinENCF, esquema31);
  expect(resultado.valido).toBe(false);
  expect(resultado.errores.join(' ')).toMatch(/eNCF/i);
});

// Control: el validador tiene que poder distinguir algo.
it('rechaza XML que no es un e-CF en absoluto', async () => {
  const resultado = await validarContraXSD('<hola/>', esquema31);
  expect(resultado.valido).toBe(false);
});
```

That third test is the one that matters. A validator wired to the wrong schema
path, or one that swallows its own errors, returns `true` for everything — and a
check that always passes looks exactly like a check that passes.

The XSD reserves a mandatory `xs:any` slot for the Signature, so an unsigned
e-CF never validates. Validation happens after signing, which matters for the
Vercel demo, where signing is disabled (Tasks 11 and 12).

**Commit:** `feat(ecf): validate the XML against DGII's XSD`

---

### Task 8: XMLDSig signature — spike first

**Corrected on 2026-09-12.** The design and the first version of this plan said
XAdES-BES. DGII's own signing specification, `esquemas/docs/Firmado-de-e-CF.pdf`,
describes a plain enveloped XMLDSig signature, and nothing in it is XAdES:

- `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">`, appended as the last
  child of `<ECF>`: the `xs:any` slot the XSD reserves after `FechaHoraFirma`;
- `CanonicalizationMethod`: `http://www.w3.org/TR/2001/REC-xml-c14n-20010315`;
- `SignatureMethod`: `http://www.w3.org/2001/04/xmldsig-more#rsa-sha256`;
- a single `Reference` with an empty `URI=""`, so the signature covers the whole
  document (p.2), and the `http://www.w3.org/2000/09/xmldsig#enveloped-signature`
  transform;
- `DigestMethod`: `http://www.w3.org/2001/04/xmlenc#sha256`. SHA-256 is
  mandatory (p.2);
- `KeyInfo` → `X509Data` → `X509Certificate`.

Take the URIs from the code samples, not from the example XML on p.3, which
misspells three of them (`RECxml-c14n`, `xmldsigmore`, `envelope d-signature`).
The TypeScript sample (pp.5–12) also puts `SignatureValue` after `KeyInfo`;
XMLDSig, and the example on p.3, put it right after `SignedInfo`.

**What the spike found** (2026-09-12, in a scratch directory outside the repo):

- `node-forge` opens `.p12` files with OpenSSL 3's default encryption (PBES2,
  AES-256-CBC) and with `-legacy` (RC2-40), and rejects a wrong password.
- `xml-crypto` 6.1.2 cannot sign this structure. With `enveloped-signature` as
  the only transform, it digests xmldom's serialization of the document when
  signing, but appends C14N when verifying, as XMLDSig requires
  (`lib/signed-xml.js`, lines 315 and 574–575). The two agree until the document
  has an empty element: type 32 always carries `<Comprador></Comprador>`, which
  serializes as `<Comprador/>`, and its signature failed the library's own
  verification and an independent one. An explicit C14N transform fixes it but
  adds a second `<Transform>` that DGII's structure does not have.
- Decided with Gabriel: `firma.ts` builds `SignedInfo` and `Signature` itself,
  canonicalizes with `xml-crypto`'s `C14nCanonicalization` and signs with Node's
  `crypto`. The document stays byte-for-byte what `construirXML` produced, plus
  the signature. Signed that way, types 31 and 32 verify with `xml-crypto` and,
  independently, with libxml2's canonicalization and Node's `crypto`, and they
  validate against the XSD. Not reported upstream yet.

**Files:**
- Create: `lib/ecf/firma.ts` — takes the `.p12` bytes and its password, or a key
  and certificate; never reads from disk.
- Test: `lib/ecf/firma.test.ts` — generates its own keys, so the repo holds no
  signing material. It pins the exact structure, verifies with `xml-crypto` and
  with libxml2, validates against the XSD, and alters an amount after signing to
  prove the signature notices.

`firmarECF` verifies its own signature before returning it: a key that does not
belong to the certificate fails there, not in DGII's hands.

**Commit:** `feat(ecf): XMLDSig signing, as DGII specifies it`

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
  leerComprobante(encf: string): Promise<string>;
  listarComprobantes(tipo?: TipoECF): Promise<string[]>;
}
```

`guardarComprobante` must reject a duplicate e-NCF. In memory that is a `Map`
check; on disk it is the filesystem. Both implementations share the same test
suite, so the behaviour cannot drift between them.

`leerComprobante` was added while building it: without it the shared suite
cannot prove that a rejected duplicate leaves the original XML untouched, and
printing and the 606/607 reports need to read what was issued anyway. The suite
lives in `lib/storage/contrato.ts`; the sequence rules both implementations
apply live in `lib/storage/secuencias.ts`.

**Commit:** `feat(storage): interface and in-memory implementation`

---

### Task 10: File storage, and the uniqueness constraint

**Files:**
- Create: `lib/storage/archivos.ts`
- Test: `lib/storage/archivos.test.ts`

**Decided on 2026-09-12: no `secuencias.json`.** The next sequence is always
read from `facturas/`; at a small business's scale that is cheap, and a cache is
one more file that can disagree with what was issued. The file implementation
runs the shared suite in `lib/storage/contrato.ts` plus the tests below.
`datos/` holds real fiscal records and the `.p12`, so it goes in `.gitignore`.

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

it('una instancia nueva sobre la misma carpeta sigue la secuencia', async () => {
  await new AlmacenamientoEnArchivos(dir).guardarComprobante('E310000000007', '<a/>');
  expect(await new AlmacenamientoEnArchivos(dir).proximaSecuencia('31')).toBe(8);
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

**Decided on 2026-09-12: the demo signs with a demonstration certificate.** The
XSD requires the signature, so a demo with signing disabled could never validate
or issue anything. On Vercel the app generates, in memory and at startup, a
self-signed certificate with no fiscal value, says so on screen, and runs the
real flow with it; it holds nobody's fiscal identity. Locally, the credential is
`datos/certificado.p12` and its password.

**Commit:** `feat(storage): file storage locally, memory on Vercel`

---

## Phase 4 — The application

### Task 12: Issue an invoice

The form, the engine call, the save. The invoice is written only after the XML
validates — an invalid comprobante must never consume a sequence number.

**Decided on 2026-09-12: v1 issues types 31 and 32 only.** Credit and debit notes
need `InformacionReferencia` and a rule for notes issued more than 30 days later,
which the documents leave open.

The order is build, sign, validate, save: the XSD requires the signature, so
validation cannot come first. `FechaHoraFirma` is the signing time in GMT-4,
`dd-MM-AAAA HH:mm:ss`, and DGII checks that it is not later than the current
time (Formato e-CF, p.58). Nothing is written before the XML validates, and the
sequence comes from what was written, so a failed attempt consumes no number.
When two issues race for the same number, the second gets `EEXIST` and the flow
tries again with the next one.

**Found on 2026-09-12, while building the form:** `FechaLimitePago` is
"Condicional a que el tipo de pago sea a crédito" in 31 and 32 (Formato e-CF,
p.9: `dd-MM-AAAA`, not before `FechaEmision`). **Decided the same day: add it.**
`construirXML` requires it with `TipoPago` 2, refuses it with any other payment
type ("Solo para facturas a crédito") and writes it right after `TipoPago`, where
the XSD puts it. The form asks for the date when the sale is on credit.

The Server Action is a trust boundary: anyone can POST to it. `lib/formulario.ts`
translates the posted text into DGII codes and rejects anything else; amounts,
lengths and RNC stay with the engine. The credential comes from the mode alone:
locally, a missing `datos/certificado.p12` stops the issue, and it never falls
back to the demo certificate, which would sign real sequence numbers with no
fiscal value.

`next dev` and `next start` bind to 127.0.0.1. Their default, 0.0.0.0, would let
anyone on the local network issue invoices signed with the business's
certificate.

`next.config.ts`, each line checked by building without it:
- `serverExternalPackages: ['xmllint-wasm']`: bundled, validation fails with
  `ENOENT` on `xmllint.wasm`.
- `outputFileTracingExcludes` for `datos/**` and `esquemas/docs/**`: the trace
  follows the paths `lib/credencial.ts` and `lib/storage` build, and pulled
  `datos/certificado.p12` and `datos/emisor.json` into the server output.
  `esquemas/` is traced without help, so no include is needed.

**Commit:** `feat(app): issue an e-CF`

### Task 13: Printed representation

`@react-pdf/renderer`, carrying the e-NCF, the issuer's RNC, the totals and a QR
code. **Verify what the QR must contain before generating one** — it encodes a
DGII verification URL whose exact shape is in the technical documentation.

**Verified on 2026-09-12 (Informe Técnico e-CF v1.0, section 18, pp.31–40):** the
QR goes bottom left, at least 2 cm from the edge and 22 × 22 mm, and encodes
`https://ecf.dgii.gov.do/ecf/ConsultaTimbre` with `RncEmisor`, `RncComprador`,
`ENCF`, `FechaEmision`, `MontoTotal`, `FechaFirma` and `CodigoSeguridad`. A
factura de consumo under DOP$250,000.00 uses
`https://fc.dgii.gov.do/eCF/ConsultaTimbreFC` with `RncEmisor`, `ENCF`,
`MontoTotal` and `CodigoSeguridad`. The text calls `CodigoSeguridad` "los primeros
seis (6) dígitos del hash generado en el SignatureValue"; the document's own
models print codes like `C78q+V`, so it is the first six characters of the base64
`SignatureValue`. It is printed under the QR, with the signing date and time.

**Decided the same day:** no per-item ITBIS column, because the XML carries ITBIS
per rate only and the totals print it as the XML has it. The issuer's municipio
and provincia go inside the address, as in DGII's models, with no new fields.
The QR comes from `qrcode-generator`, and a test decodes it with `jsqr`.

The PDF embeds Atkinson Hyperlegible Next (`@fontsource/atkinson-hyperlegible-next`,
OFL): with the standard Helvetica, which is not embedded, poppler drew no text at
all. Known gap: a representation longer than one page numbers its pages but does
not print the per-page subtotals the Informe Técnico asks for (pp.36–37).

**Commit:** `feat(app): printed representation`

### Task 14: 606 / 607 export

**Found on 2026-09-12**, in DGII's "Formato de Envío 607 (Norma General 07-2018 y
05-2019)" package: its instructivo (September 2020) and "Herramienta de Envio
Formato 607.xls" (last saved May 2023).
- The 607 is monthly, due by the 15th. It has a header (RNC, period `AAAAMM`, a
  record count of at most 65,000) and 23 detail fields: the buyer's RNC, cédula or
  passport and its type, NCF, modified NCF, TipoIngresos, date `AAAAMMDD`,
  retention date, amount without taxes, ITBIS, retentions and other taxes, legal
  tip, and the amount paid by each payment method (cash, cheque/transfer/deposit,
  card, credit, gift bonds, barter, other), which must add up to the invoice total.
- Facturas de consumo under RD$250,000.00 are not itemized; they go as a count
  and a total in the Oficina Virtual's summary.
- The Excel tool's macros generate the TXT. The instructivo does not write down
  its layout, and the readable part of the macros is the legacy fixed-width format.
- Neither document mentions e-CF. The tool validates B-series NCF, and nothing
  shows that it accepts an e-NCF.
- The 606 needs purchases, which the app does not record.

**Decided the same day:** paused until Gabriel confirms with DGII whether an
e-CF issuer files the 607 for its e-CF, and with which NCF. If it goes ahead, the
output is a CSV with the instructivo's 23 fields, to paste into DGII's tool,
which generates and validates the TXT. The form then gains the payment method,
because contado does not say how a sale was paid.

**Commit:** `feat(app): 606 and 607 reports`

### Task 15: Say plainly what this is not

A visible notice, in the app: this instance does not transmit to DGII, and using
it does not make anyone compliant. Plus the requirements that do: RNC, Alta
e-NCF, digital certificate, DGII certification.

**Commit:** `feat(app): state what the tool does not do`

---

## Phase 5 — Ship it

### Task 16: Deploy to Vercel

Connect the repo, deploy, confirm the demo runs in memory mode and signs with
the demonstration certificate, and that the page says so.

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

# invoice-generator

A self-hosted issuer of Dominican electronic fiscal receipts (e-CF). It builds the
XML for invoice types 31 (Factura de Crédito Fiscal) and 32 (Factura de Consumo),
signs it with XMLDSig the way DGII specifies, validates it against DGII's XSD,
saves it, and prints its representation with DGII's verification QR. It also
records purchases, typed in or imported from a supplier's e-CF XML, and writes the
monthly 606 file for DGII's Oficina Virtual. The app's interface is in Spanish.

**Demo:** <https://invoice-generator-orpin-nine.vercel.app>. It signs with a
throwaway certificate, has no fiscal value, and keeps what you issue in memory
until the server restarts.

## What it does not do

- **It does not transmit anything to DGII.** An e-CF that DGII has not received
  has no tax validity (DGII's e-CF FAQ, question 1.4.12), so its printed
  representation cannot support a tax credit.
- **Using it does not make you an emisor electrónico.** That takes DGII's
  authorization, a digital certificate for tax processes from a provider
  authorized by INDOTEL, and passing DGII's certification.

The app says the same on its main page.

## How it works

The environment picks the mode:

| | Local | Demo |
|---|---|---|
| When | `VERCEL` is not set | `VERCEL=1` |
| Issuer | `datos/emisor.json` | fictitious, RNC of zeros |
| Certificate | `datos/certificado.p12` | self-signed, generated at startup |
| Storage | `datos/facturas/<e-NCF>.xml` | memory |

- The order is build, sign, validate, save. Nothing is saved if the XML does not
  validate, and a failed attempt does not use up a number.
- The next e-NCF comes from what was already saved, not from a counter. Files are
  written with the `wx` flag, so a duplicate fails instead of overwriting, and
  issuing stops at the end of the authorized range.
- `/facturas/<e-NCF>` returns the printed representation as a PDF.

## Purchases and the 606

- `/compras` lists a month's purchases. Locally each one is saved as
  `datos/compras/<RNC>_<NCF>.json`, with the supplier's XML next to it when it was
  imported. Supplier and NCF are the key, so the same NCF can't be recorded twice.
- A received e-CF 31, 33 or 34 fills the form. The XML has to validate against
  DGII's XSD and be addressed to your RNC. What it doesn't say (the type of goods
  and services, and sometimes the payment method) you complete.
- A month's 606 holds that month's invoices. It also holds earlier invoices paid
  that month with a retention, sent again with their original date, as DGII's
  instructions ask. If any purchase in the month has an error, the app writes no
  file and says what to fix.
- The file is written the way DGII's Excel tool writes it, checked against files
  that tool generated and DGII accepted: a `606|RNC|AAAAMM|count` header and 23
  fields per line. What only DGII can check (an active supplier, an authorized
  NCF, an accepted e-CF) shows up when it processes the upload.
- A purchase with no ITBIS, debit and credit notes, and retentions haven't been
  through DGII yet: run the first file that has one through DGII's pre-validator.
- There's no 607: DGII doesn't take e-CF in it (e-CF FAQ, question 1.4.13).

## Running it locally

You need Node 22.12 or later (see `.nvmrc`).

```bash
npm ci
```

Create `datos/emisor.json` with your details and the e-NCF ranges DGII authorized:

```json
{
  "RNCEmisor": "123456789",
  "RazonSocialEmisor": "Tu razón social",
  "DireccionEmisor": "Tu dirección",
  "rangos": {
    "31": { "desde": 1, "hasta": 100, "FechaVencimientoSecuencia": "31-12-2027" },
    "32": { "desde": 1, "hasta": 100, "FechaVencimientoSecuencia": "31-12-2027" }
  }
}
```

Put your certificate at `datos/certificado.p12` and its password in `.env.local`:

```
CERTIFICADO_CLAVE=your-certificate-password
```

Git ignores `datos/`, `*.p12` and `.env*`, so the certificate never leaves your
machine. Then build and start:

```bash
npm run build
npm start
```

The app listens on <http://127.0.0.1:3000>, and only on your machine.

## Development

```bash
npm run dev        # development server on 127.0.0.1:3000
npm test           # Vitest
npx tsc --noEmit   # type check
npm run lint       # ESLint
```

## DGII's schemas

`esquemas/` holds DGII's XSD files as DGII publishes them, with their sha256 in
`esquemas/MANIFIESTO.json`. `esquemas/docs/` holds the DGII documents the code
follows. DGII changes schemas without notice, so check them before each release:

```bash
node scripts/bajar-esquemas.mjs               # exits with 1 if a schema changed
node scripts/bajar-esquemas.mjs --actualizar  # downloads them and rewrites the manifest
```

The type 31 schema uses a type it never defines. The validator adds that one
definition in memory, and a test fails the day DGII fixes the schema.

## Layout

```
lib/ecf/       the fiscal engine: e-NCF, ITBIS and totals, XML, signature, XSD validation
lib/compras/   purchases: amounts, dates, validation, the 606 file, e-CF import
lib/storage/   the storage interface, with file and in-memory implementations
lib/           the issuing flow, form parsing and credentials
app/           Next.js: the issuing and purchases pages, server actions, the PDF route
esquemas/      DGII's XSD files and reference documents
docs/plans/    the design and the implementation plan
```

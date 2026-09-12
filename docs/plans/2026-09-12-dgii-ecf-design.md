# Diseño — Emisor de comprobantes fiscales electrónicos (e-CF) para RD

**Fecha:** 2026-09-12
**Estado:** aprobado, pendiente de plan de implementación
**Repo:** `Gabbs27/invoice-generator` — se reescribe encima, no se crea uno nuevo

---

## Por qué ahora

La Ley 32-23, promulgada el 16 de mayo de 2023, obliga a emitir comprobantes
fiscales electrónicos. El calendario es escalonado:

| Categoría | Fecha |
|---|---|
| Grandes Contribuyentes Nacionales | mayo 2024 |
| Grandes Locales y Medianos | 15 de noviembre de 2025 |
| Pequeños, Micro y No Clasificados | **15 de noviembre de 2026** |

La última fecha era el 15 de mayo de 2026 y se prorrogó seis meses de forma
automática. Incumplir expone a multas de 5 a 50 salarios mínimos y a que los
comprobantes pierdan validez fiscal.

Eso deja a casi todo negocio pequeño dominicano con dos meses para resolver algo
que no sabe cómo resolver. No es una hipótesis de mercado: es una fecha.

## Qué es y qué no es

**Es** un emisor self-hosted: un negocio corre su propia instancia, con su RNC,
sus rangos de secuencia y su certificado digital, y emite sus comprobantes.

**No es**, en la v1:

- Un transmisor. Genera, firma y valida el XML. No lo envía a DGII.
- Una garantía de cumplimiento. Cumplir exige además el RNC del negocio, el Alta
  de e-NCF, un certificado digital de una entidad de certificación autorizada y
  pasar el proceso de certificación de DGII.

Las dos frases anteriores van visibles **dentro de la aplicación**, no solo en el
README. Una herramienta que insinúa que te pone al día con Impuestos Internos
cuando no lo hace no tiene un problema de mercadeo.

## Decisiones

### Un repo, dos modos

Next.js, porque un solo código cubre los dos usos que el proyecto tiene:

| | Local (uso real) | Vercel (demostración) |
|---|---|---|
| Cómo corre | `npm start` en la máquina del negocio | despliegue público |
| Almacenamiento | carpeta `./datos/` | memoria, se pierde al salir |
| Certificado | el `.p12` dentro de esa carpeta | ninguno; la firma queda deshabilitada |
| Para qué sirve | emitir de verdad | enseñarlo y probarlo |

El `.p12` nunca sale de la máquina del negocio. Eso no es una limitación del
modelo self-hosted, es su mejor argumento: nadie custodia la identidad fiscal de
nadie. Un `.p12` ajeno firma comprobantes a nombre de otro ante DGII; guardar
veinte es custodiar veinte identidades fiscales.

### La carpeta es la base de datos

```
datos/
  emisor.json              RNC, razón social, rangos e-NCF autorizados
  secuencias.json          próximo número por tipo de comprobante
  certificado.p12          solo en local, fuera de git
  facturas/
    E310000000001.xml      el XML firmado, tal como se emitió
    E310000000002.xml
```

DGII exige conservar el XML de cada comprobante emitido. Guardarlos como archivos
no es un atajo mientras no hay base de datos: es exactamente el artefacto que hay
que conservar.

### El sistema de archivos da la restricción de unicidad

El riesgo real de un emisor no es el XML, es la secuencia. Dos comprobantes no
pueden llevar el mismo e-NCF, no puede haber huecos, y no se puede pasar del
rango autorizado.

```js
writeFileSync(`datos/facturas/${encf}.xml`, xml, { flag: 'wx' });
```

`wx` falla con `EEXIST` si el archivo ya existe. Es el mismo papel que cumpliría
un índice único en Postgres, sin Postgres, y con la propiedad que importa: un
duplicado **explota** en vez de pasar callado.

El número siguiente se deriva leyendo el directorio, no de un contador en el que
haya que confiar. `secuencias.json` es una caché; si se pierde o se corrompe, se
reconstruye desde los archivos. La fuente de verdad es lo que se emitió, no lo
que un contador dice que se emitió.

Emitir se rechaza al alcanzar el tope del rango autorizado en `emisor.json`.

### El motor va aparte de la interfaz

```
lib/ecf/          TypeScript puro, sin framework, sin I/O
  tipos.ts        los 10 tipos de comprobante
  encf.ts         formato y validación del e-NCF
  calculo.ts      ITBIS, retenciones, totales
  xml.ts          construcción del XML
  firma.ts        XAdES-BES con .p12
  validar.ts      contra el XSD de DGII
  reportes.ts     606 / 607
lib/storage/      la interfaz y sus dos implementaciones
app/              Next.js: formularios y representación impresa
```

La lógica fiscal es la parte peligrosa y así se prueba sin navegador, sin
certificado y sin disco. Es además el mismo motor que NegocioRD podría consumir
después, en vez de dos implementaciones del mismo XML divergiendo.

`Transmisor` existe como interfaz desde el primer día, con una implementación que
no hace nada. El día que haya certificado y Alta e-NCF se agrega
`TransmisorDGII` y no se reescribe nada más.

## Lo que se conserva del proyecto actual

Casi nada. Hoy es Create React App —`react-scripts`, descontinuado— con un
formulario editable y cero DGII: ni NCF, ni RNC, ni ITBIS. Sobrevive
`@react-pdf/renderer`, que sigue siendo la herramienta correcta para la
representación impresa.

Se reescribe en el mismo repo para conservar los 15 commits de historia y porque
el portafolio ya enlaza ahí.

## Datos verificados

Todo lo siguiente sale de documentación de DGII o de su portal:

- **e-NCF:** 13 caracteres. `E` + 2 dígitos de tipo + 10 de secuencia.
- **Tipos:** 31 Factura de Crédito Fiscal, 32 Factura de Consumo, 33 Nota de
  Débito, 34 Nota de Crédito, 41 Compras, 43 Gastos Menores, 44 Regímenes
  Especiales, 45 Gubernamental, 46 Exportaciones, 47 Pagos al Exterior.
- **Firma:** XAdES-BES sobre XML, con certificado `.p12`.
- **Otros documentos del flujo:** RFCE (resumen de factura de consumo), ACECF
  (aprobación comercial), ARECF (acuse de recibo).
- **Certificación como emisor:** exige Alta NCF, certificado digital de una
  entidad de certificación autorizada, el software, y estar al día con las
  obligaciones tributarias. DGII habilita un ambiente de pruebas tras
  pre-aprobar la solicitud.

## Riesgo abierto

**Los XSD hay que bajarlos a mano.** El portal de DGII responde HTTP 403 a
descargas automatizadas y 401 al listado de su biblioteca de documentos. Los
esquemas se bajan desde un navegador, de *Documentación sobre eCF → Formatos
XML*, y se commitean al repo.

Hasta que ese archivo exista, «el XML es válido» es una afirmación sin nada
debajo. Es el primer paso del plan y bloquea la validación.

## Cómo se verifica

- El XML valida contra el XSD commiteado, o el test se pone rojo.
- Secuencia: emisión concurrente, agotamiento del rango, `secuencias.json`
  borrado, e-NCF duplicado. Los cuatro casos tienen prueba.
- ITBIS y totales contra casos conocidos, incluidos los de tasa reducida.
- RNC de 9 dígitos y cédula de 11, con dígito verificador.
- Cada guard se comprueba en los dos sentidos: rojo sobre el estado roto, verde
  sobre el arreglado, en la misma sesión.

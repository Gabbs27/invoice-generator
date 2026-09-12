# Esquemas XSD de DGII

Los esquemas oficiales contra los que se valida el XML de cada e-CF, tal como los
publica DGII y **sin renombrar**.

## De dónde salen

<https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Paginas/documentacionSobreE-CF.aspx>
→ *Documentación Técnica (XSD)*

La página principal de facturación electrónica no enlaza los XSD. Esta sí.

## Cómo se bajan

```bash
node scripts/bajar-esquemas.mjs               # comprueba contra DGII, sale con 1 si algo cambió
node scripts/bajar-esquemas.mjs --actualizar  # descarga y reescribe MANIFIESTO.json
```

Este proyecto creyó un rato que DGII bloqueaba las descargas automatizadas, y lo
escribió en su plan. No es así: el portal responde 403 al User-Agent de curl y de
fetch, y 200 al de un navegador. Es un filtro por User-Agent. El script manda
cabeceras de navegador.

Lo que sí responde 401 es el listado de la biblioteca de documentos. Por eso los
enlaces se sacan de la página pública y no del listado.

## Qué hay

| Archivo | Qué valida | Modificado por DGII |
|---|---|---|
| `e-CF 31 v.1.0.xsd` | Factura de Crédito Fiscal | 2025-10-16 |
| `e-CF 32 v.1.0.xsd` | Factura de Consumo | 2025-10-16 |
| `e-CF 33 v.1.0.xsd` | Nota de Débito | **2026-04-01** |
| `e-CF 34 v.1.0.xsd` | Nota de Crédito | **2026-04-01** |
| `e-CF 41 v.1.0.xsd` | Compras | 2025-10-16 |
| `e-CF 43 v.1.0.xsd` | Gastos Menores | 2025-10-16 |
| `e-CF 44 v.1.0.xsd` | Regímenes Especiales | 2025-10-16 |
| `e-CF 45 v.1.0.xsd` | Gubernamental | 2025-10-16 |
| `e-CF 46 v.1.0.xsd` | Exportaciones | 2025-10-16 |
| `e-CF 47 v.1.0.xsd` | Pagos al Exterior | 2025-10-16 |
| `RFCE 32 v.1.0.xsd` | Resumen de Factura de Consumo | 2023-06-20 |
| `ARECF v1.0.xsd` | Acuse de Recibo | 2023-06-20 |
| `ANECF v.1.0.xsd` | Anulación de e-CF | 2023-06-20 |
| `ACECF v.1.0.xsd` | Aprobación Comercial | 2022-12-21 |
| `Semilla v.1.0.xsd` | Semilla de autenticación | 2020-11-12 |

`MANIFIESTO.json` guarda de cada uno el sha256, los bytes, la URL y esa fecha,
que no viene dentro del archivo: solo aparece en la página.

Los nombres llevan espacios y no siguen un patrón (`ARECF v1.0` contra
`ANECF v.1.0`). Para ir de un tipo de comprobante a su archivo, usa el campo
`tipo` del manifiesto; no armes el nombre concatenando texto.

## Por qué la comprobación importa

Los esquemas 33 y 34 cambiaron el 1 de abril de 2026, seis meses después que el
resto. Un validador que corre contra un XSD viejo aprueba XML que DGII rechaza, y
lo aprueba en verde.

Correr `node scripts/bajar-esquemas.mjs` antes de cada release es lo que
convierte «el XML es válido» en «el XML es válido contra lo que DGII publica hoy».
También detecta un XSD editado a mano en el repo.

## `docs/`

Especificaciones en PDF, bajadas del mismo portal: formato e-CF, ARECF, ACECF,
RFCE, el Informe Técnico, el proceso de certificación del emisor, las dos guías
básicas y *Firmado de e-CF* (sección «Instructivos sobre Facturación
Electrónica»), que es donde DGII define la firma. La *Descripción Técnica v1.6* que todavía aparece en buscadores ya no
existe: su URL da 404.

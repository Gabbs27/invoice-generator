# Esquemas XSD de DGII

Aquí van los esquemas oficiales contra los que se valida el XML de cada e-CF.

**Están vacíos a propósito.** El portal de DGII responde HTTP 403 a descargas
automatizadas y 401 al listado de su biblioteca de documentos, así que estos
archivos se bajan desde un navegador y se commitean a mano.

## De dónde salen

<https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Paginas/default.aspx>

→ *Documentación sobre eCF* → *Formatos XML*

## Qué va aquí

Un XSD por tipo de comprobante, versión 1.0:

```
ECF_31_v1.0.xsd    Factura de Crédito Fiscal
ECF_32_v1.0.xsd    Factura de Consumo
ECF_33_v1.0.xsd    Nota de Débito
ECF_34_v1.0.xsd    Nota de Crédito
ECF_41_v1.0.xsd    Compras
ECF_43_v1.0.xsd    Gastos Menores
ECF_44_v1.0.xsd    Regímenes Especiales
ECF_45_v1.0.xsd    Gubernamental
ECF_46_v1.0.xsd    Exportaciones
ECF_47_v1.0.xsd    Pagos al Exterior
```

Y en `docs/`, los PDF de especificación: el formato del e-CF, el del acuse de
recibo (ARECF), el de aprobación comercial (ACECF) y el del resumen de factura
de consumo (RFCE).

Los nombres reales de los archivos que descarga DGII pueden no coincidir con los
de arriba. **No los renombres para que cuadren con esta lista**: ajusta la lista.
El nombre que importa es el que trae el archivo.

## Por qué se commitean

Para que el validador corra contra el archivo exacto, versionado, y no contra lo
que hubiera en el portal el día que alguien ejecutó el build. Si DGII publica una
versión nueva, entra como un commit que se puede leer en el diff.

## Cómo saber que sirven

```bash
ls esquemas/*.xsd | wc -l          # mayor que cero
head -1 esquemas/ECF_31_v1.0.xsd   # empieza con <?xml
grep -c "xs:schema" esquemas/*.xsd # cada uno declara un esquema
```

Mientras esta carpeta esté vacía, cualquier afirmación sobre que el XML generado
es válido no tiene nada debajo.

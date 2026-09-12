import { validateXML } from 'xmllint-wasm';

export interface ResultadoValidacion {
  valido: boolean;
  errores: string[];
}

// El XSD 31 que publica DGII usa IndicadorServicioTodoIncluidoType y no lo define, así
// que no compila. Esta es la definición de los XSD 33, 34, 44 y 45, byte por byte. Una
// prueba se pone roja el día que DGII corrija el 31, y ese día esto se borra.
const DEFINICION_TODO_INCLUIDO =
  '  <xs:simpleType name="IndicadorServicioTodoIncluidoType">\r\n' +
  '    <xs:restriction base="xs:integer">\r\n' +
  '      <xs:enumeration value="1"/> <!--Indicador Servicio Todo Incluido-->\r\n' +
  '    </xs:restriction>\r\n' +
  '  </xs:simpleType>\r\n';

export function completarEsquema(esquema: string): string {
  const usa = esquema.includes('type="IndicadorServicioTodoIncluidoType"');
  const define = esquema.includes('name="IndicadorServicioTodoIncluidoType"');
  if (!usa || define) return esquema;
  const cierre = esquema.lastIndexOf('</xs:schema>');
  return esquema.slice(0, cierre) + DEFINICION_TODO_INCLUIDO + esquema.slice(cierre);
}

// Un XML que no cumple el esquema vuelve como inválido, con los errores de libxml2. Un
// esquema que no compila rechaza la promesa: eso no es culpa de la factura.
export async function validarContraXSD(
  xml: string,
  esquema: string
): Promise<ResultadoValidacion> {
  const resultado = await validateXML({
    xml: [{ fileName: 'e-CF.xml', contents: xml }],
    schema: [completarEsquema(esquema)],
  });
  return { valido: resultado.valid, errores: resultado.errors.map((error) => error.message) };
}

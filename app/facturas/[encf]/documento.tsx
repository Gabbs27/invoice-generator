import { join } from 'node:path';
import { Document, Font, Page, Path, StyleSheet, Svg, Text, View } from '@react-pdf/renderer';
import { matrizQR } from '@/lib/ecf/qr';
import {
  codigoDeSeguridad,
  urlDeConsulta,
  type DatosDeRepresentacion,
} from '@/lib/ecf/representacion';
import { esTipoValido, nombreTipo } from '@/lib/ecf/tipos';
import { conMiles } from '@/lib/formato';

// Informe Técnico e-CF v1.0, sección 18.2: el tipo de e-CF en palabras, el e-NCF y el
// vencimiento arriba a la derecha; el emisor arriba a la izquierda y el cliente debajo; el
// detalle en el centro; y abajo a la izquierda el QR, con el código de seguridad y la fecha de
// la firma debajo.

// La fuente va dentro del PDF. Sin ella cada visor pone la Helvetica que tenga, y hay visores
// que la reemplazan por una fuente que no dibuja el texto.
const FUENTES = join(
  process.cwd(),
  'node_modules',
  '@fontsource',
  'atkinson-hyperlegible-next',
  'files'
);
const FUENTE = 'Atkinson Hyperlegible Next';
Font.register({
  family: FUENTE,
  fonts: [
    { src: join(FUENTES, 'atkinson-hyperlegible-next-latin-400-normal.woff'), fontWeight: 400 },
    { src: join(FUENTES, 'atkinson-hyperlegible-next-latin-700-normal.woff'), fontWeight: 700 },
  ],
});
// react-pdf separa palabras con las reglas del inglés; en español se parten mal.
Font.registerHyphenationCallback((palabra) => [palabra]);

const MM = 72 / 25.4;

// El QR empieza a 2 cm del borde, mide 22 mm como mínimo y lleva 3 mm de margen (pág. 35).
const BORDE = 20 * MM;
const MARGEN_QR = 3 * MM;
const LADO_QR = 25 * MM;

const TINTA = '#1b2436';
const TENUE = '#5a6275';
const LINEA = '#b8bfcc';
const AZUL = '#2446a6';

const estilos = StyleSheet.create({
  pagina: {
    paddingTop: 18 * MM,
    paddingHorizontal: BORDE,
    // Deja libre el lugar del QR, que se repite al pie de cada página.
    paddingBottom: BORDE + LADO_QR + MARGEN_QR * 2 + 14 * MM,
    fontFamily: FUENTE,
    fontSize: 9,
    lineHeight: 1.35,
    color: TINTA,
  },
  encabezado: { flexDirection: 'row', justifyContent: 'space-between' },
  emisor: { flexShrink: 1, paddingRight: 12 },
  razonSocial: { fontWeight: 700, fontSize: 13, marginBottom: 2 },
  documento: { alignItems: 'flex-end' },
  tipo: { fontWeight: 700, fontSize: 12, color: AZUL, marginBottom: 3 },
  negrita: { fontWeight: 700 },
  regla: { borderBottomWidth: 1, borderBottomColor: AZUL, marginVertical: 10 },
  titulos: {
    flexDirection: 'row',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: TINTA,
    fontWeight: 700,
  },
  fila: {
    flexDirection: 'row',
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: LINEA,
  },
  cantidad: { width: '11%', textAlign: 'right', paddingRight: 10 },
  descripcion: { flexGrow: 1, flexBasis: 0, paddingRight: 8 },
  monto: { width: '15%', textAlign: 'right' },
  totales: { alignSelf: 'flex-end', width: '45%', marginTop: 10 },
  renglon: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  total: {
    marginTop: 3,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: TINTA,
    fontWeight: 700,
    fontSize: 11,
  },
  consulta: { position: 'absolute', left: BORDE - MARGEN_QR, bottom: BORDE },
  qr: { padding: MARGEN_QR, backgroundColor: '#ffffff', alignSelf: 'flex-start' },
  datoDeConsulta: { paddingLeft: MARGEN_QR },
  aviso: {
    position: 'absolute',
    right: BORDE,
    bottom: BORDE,
    width: 70 * MM,
    fontSize: 7.5,
    color: TENUE,
    textAlign: 'right',
  },
  paginacion: {
    position: 'absolute',
    right: BORDE,
    top: 8 * MM,
    fontSize: 7.5,
    color: TENUE,
  },
  marcaDeAgua: {
    position: 'absolute',
    top: 115 * MM,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontWeight: 700,
    fontSize: 44,
    color: '#b42318',
    opacity: 0.12,
  },
});

function CodigoQR({ texto }: { texto: string }) {
  const matriz = matrizQR(texto);
  const trazo = matriz
    .flatMap((fila, y) => fila.flatMap((oscuro, x) => (oscuro ? [`M${x} ${y}h1v1h-1z`] : [])))
    .join('');
  return (
    <Svg width={LADO_QR} height={LADO_QR} viewBox={`0 0 ${matriz.length} ${matriz.length}`}>
      <Path d={trazo} fill="#000000" />
    </Svg>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <Text>
      <Text style={estilos.negrita}>{etiqueta}: </Text>
      {valor}
    </Text>
  );
}

export function documentoImpreso(datos: DatosDeRepresentacion, demostracion: boolean) {
  const { Emisor, Comprador, Items, Totales } = datos;
  const tipo = esTipoValido(datos.TipoeCF) ? nombreTipo(datos.TipoeCF) : datos.TipoeCF;
  const hayDescuentos = Items.some((item) => item.DescuentoMonto !== undefined);
  const hayRecargos = Items.some((item) => item.RecargoMonto !== undefined);
  const renglones = [
    ['Subtotal gravado', Totales.MontoGravadoTotal],
    [`ITBIS ${Totales.ITBIS1} %`, Totales.TotalITBIS1],
    [`ITBIS ${Totales.ITBIS2} %`, Totales.TotalITBIS2],
    [`ITBIS ${Totales.ITBIS3} %`, Totales.TotalITBIS3],
    ['Total ITBIS', Totales.TotalITBIS],
    ['Subtotal exento', Totales.MontoExento],
  ].filter((renglon): renglon is [string, string] => renglon[1] !== undefined);

  return (
    <Document title={`${tipo} ${datos.eNCF}`} author={Emisor.RazonSocialEmisor}>
      <Page size="LETTER" style={estilos.pagina}>
        {demostracion && (
          <Text fixed style={estilos.marcaDeAgua}>
            SIN VALOR FISCAL
          </Text>
        )}
        <Text
          fixed
          style={estilos.paginacion}
          render={({ pageNumber, totalPages }) =>
            totalPages > 1 ? `Página ${pageNumber} de ${totalPages}` : ''
          }
        />

        <View style={estilos.encabezado}>
          <View style={estilos.emisor}>
            <Text style={estilos.razonSocial}>{Emisor.RazonSocialEmisor}</Text>
            <Text>RNC {Emisor.RNCEmisor}</Text>
            <Text>{Emisor.DireccionEmisor}</Text>
            <Dato etiqueta="Fecha de emisión" valor={Emisor.FechaEmision} />
          </View>
          <View style={estilos.documento}>
            <Text style={estilos.tipo}>{tipo}</Text>
            <Dato etiqueta="e-NCF" valor={datos.eNCF} />
            {datos.FechaVencimientoSecuencia !== undefined && (
              <Dato etiqueta="Fecha de vencimiento" valor={datos.FechaVencimientoSecuencia} />
            )}
          </View>
        </View>
        <View style={estilos.regla} />

        {Comprador !== undefined && (
          <View>
            {Comprador.RazonSocialComprador !== undefined && (
              <Dato etiqueta="Razón social cliente" valor={Comprador.RazonSocialComprador} />
            )}
            {Comprador.RNCComprador !== undefined && (
              <Dato etiqueta="RNC cliente" valor={Comprador.RNCComprador} />
            )}
            <View style={estilos.regla} />
          </View>
        )}

        <View style={estilos.titulos}>
          <Text style={estilos.cantidad}>Cantidad</Text>
          <Text style={estilos.descripcion}>Descripción</Text>
          <Text style={estilos.monto}>Precio</Text>
          {hayDescuentos && <Text style={estilos.monto}>Descuento</Text>}
          {hayRecargos && <Text style={estilos.monto}>Recargo</Text>}
          <Text style={estilos.monto}>Valor</Text>
        </View>
        {Items.map((item) => (
          <View key={item.NumeroLinea} style={estilos.fila} wrap={false}>
            <Text style={estilos.cantidad}>{conMiles(item.CantidadItem)}</Text>
            {/* Pág. 34: la "E" de exento va a la izquierda de la descripción. */}
            <Text style={estilos.descripcion}>
              {item.IndicadorFacturacion === '4' ? `E  ${item.NombreItem}` : item.NombreItem}
            </Text>
            <Text style={estilos.monto}>{conMiles(item.PrecioUnitarioItem)}</Text>
            {hayDescuentos && (
              <Text style={estilos.monto}>
                {item.DescuentoMonto === undefined ? '' : conMiles(item.DescuentoMonto)}
              </Text>
            )}
            {hayRecargos && (
              <Text style={estilos.monto}>
                {item.RecargoMonto === undefined ? '' : conMiles(item.RecargoMonto)}
              </Text>
            )}
            <Text style={estilos.monto}>{conMiles(item.MontoItem)}</Text>
          </View>
        ))}

        <View style={estilos.totales} wrap={false}>
          {renglones.map(([concepto, monto]) => (
            <View key={concepto} style={estilos.renglon}>
              <Text>{concepto}</Text>
              <Text>{conMiles(monto)}</Text>
            </View>
          ))}
          <View style={[estilos.renglon, estilos.total]}>
            <Text>Total</Text>
            <Text>RD$ {conMiles(Totales.MontoTotal)}</Text>
          </View>
        </View>

        <View fixed style={estilos.consulta}>
          <View style={estilos.qr}>
            <CodigoQR texto={urlDeConsulta(datos)} />
          </View>
          <Text style={estilos.datoDeConsulta}>
            Código de seguridad: {codigoDeSeguridad(datos.SignatureValue)}
          </Text>
          <Text style={estilos.datoDeConsulta}>Fecha de firma digital: {datos.FechaHoraFirma}</Text>
        </View>
        <Text fixed style={estilos.aviso}>
          Este e-CF no se ha enviado a DGII.
          {demostracion ? ' Es una demostración: no tiene valor fiscal.' : ''}
        </Text>
      </Page>
    </Document>
  );
}

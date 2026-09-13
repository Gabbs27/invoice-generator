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
    const monto = [
      'MontoImpuestoSelectivoConsumoEspecifico',
      'MontoImpuestoSelectivoConsumoAdvalorem',
      'OtrosImpuestosAdicionales',
    ]
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
  const errores = (...mensajes: string[]): ResultadoDeImportacion => ({
    importado: false,
    errores: mensajes,
  });
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

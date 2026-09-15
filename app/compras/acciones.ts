'use server';

import { refresh } from 'next/cache';
import { archivo606, nombreDelArchivo606 } from '@/lib/compras/archivo606';
import { importarECF, type ResultadoDeImportacion } from '@/lib/compras/desdeECF';
import { historialDeProveedores, leerGastos, type LecturaDeGastos } from '@/lib/compras/desdeExcel';
import { esPeriodo } from '@/lib/compras/fechas';
import { leerCompraDelFormulario } from '@/lib/compras/formulario';
import {
  DEMASIADO_GRANDE,
  LIBRO_DEMASIADO_GRANDE,
  TAMANO_MAXIMO_DEL_LIBRO,
  TAMANO_MAXIMO_DEL_XML,
} from '@/lib/compras/limites';
import { comprasDelPeriodo } from '@/lib/compras/periodo';
import { claveDeCompra, esCompra } from '@/lib/compras/tipos';
import { validarCompra } from '@/lib/compras/validar';
import { leerLibro } from '@/lib/compras/xlsx';
import { validarContraXSD } from '@/lib/ecf/validar';
import { leerEsquema } from '@/lib/esquemas';
import { modoDeEjecucion, obtenerAlmacenamiento } from '@/lib/storage';

export type ResultadoDeGuardar =
  | { guardado: true; clave: string }
  | { guardado: false; errores: string[] };
export type ResultadoDeImportar = ResultadoDeImportacion & { xml?: string };
export type ResultadoDeBorrar = { borrado: true } | { borrado: false; errores: string[] };
export type ResultadoDel606 =
  | { generado: true; nombre: string; contenido: string }
  | { generado: false; errores: string[] };
export type ResultadoDeLeerElLibro =
  | { leido: true; lectura: LecturaDeGastos; rncDelNegocio: string }
  | { leido: false; errores: string[] };
export type ResultadoDeGuardarDelLibro =
  | { guardado: true; guardadas: number; noGuardadas: string[] }
  | { guardado: false; errores: string[] };

const mensaje = (error: unknown) => (error as Error).message;

// El XML llega como archivo desde el formulario de importar, y como archivo o texto al guardar.
async function textoDelXML(valor: FormDataEntryValue | null): Promise<string> {
  if (valor === null) return '';
  return typeof valor === 'string' ? valor : valor.text();
}

async function dependenciasDeImportacion() {
  const { RNCEmisor } = await obtenerAlmacenamiento().leerEmisor();
  return {
    rncDelNegocio: RNCEmisor,
    validar: (xml: string, tipo: string) => validarContraXSD(xml, leerEsquema(tipo)),
  };
}

export async function importarXML(datos: FormData): Promise<ResultadoDeImportar> {
  try {
    const xml = await textoDelXML(datos.get('xml'));
    if (xml === '') return { importado: false, errores: ['Elige el XML de un e-CF.'] };
    if (xml.length > TAMANO_MAXIMO_DEL_XML) {
      return { importado: false, errores: [DEMASIADO_GRANDE] };
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
    const almacenamiento = obtenerAlmacenamiento();
    const { RNCEmisor } = await almacenamiento.leerEmisor();
    const errores = validarCompra(compra, RNCEmisor);
    if (errores.length > 0) return { guardado: false, errores };
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
      const xml = await textoDelXML(datos.get('xml'));
      if (xml.length > TAMANO_MAXIMO_DEL_XML) {
        return { guardado: false, errores: [DEMASIADO_GRANDE] };
      }
      if (xml !== '') {
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
      validarCompra(linea, RNCEmisor).map((error) => `${linea.NCF} de ${linea.RNCCedula}: ${error}`)
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

// En la demostración, lo que se guarda lo ve cualquiera que entre: un libro real mostraría
// proveedores y montos.
const SOLO_EN_LOCAL =
  'Importar el libro de gastos solo se puede en modo local: en la demostración, lo que se guarda lo ve cualquiera que entre.';

const NO_LLEGARON_COMPRAS = 'No llegaron compras para guardar.';

export async function leerLibroDeGastos(datos: FormData): Promise<ResultadoDeLeerElLibro> {
  try {
    if (modoDeEjecucion() !== 'local') return { leido: false, errores: [SOLO_EN_LOCAL] };
    const periodo = datos.get('periodo');
    if (typeof periodo !== 'string' || !esPeriodo(periodo)) {
      return { leido: false, errores: [`Periodo inválido: ${String(periodo)}.`] };
    }
    const archivo = datos.get('libro');
    if (!(archivo instanceof File) || archivo.size === 0) {
      return { leido: false, errores: ['Elige el libro de gastos (.xlsx).'] };
    }
    if (archivo.size > TAMANO_MAXIMO_DEL_LIBRO) {
      return { leido: false, errores: [LIBRO_DEMASIADO_GRANDE] };
    }
    const libro = leerLibro(new Uint8Array(await archivo.arrayBuffer()));
    const almacenamiento = obtenerAlmacenamiento();
    const { RNCEmisor } = await almacenamiento.leerEmisor();
    const compras = await almacenamiento.listarCompras();
    const lectura = leerGastos(libro, {
      periodo,
      anotadas: new Set(compras.map(claveDeCompra)),
      historial: historialDeProveedores(compras),
    });
    return { leido: true, lectura, rncDelNegocio: RNCEmisor };
  } catch (error) {
    return { leido: false, errores: [mensaje(error)] };
  }
}

// El servidor no se fía de la vista previa: vuelve a validar cada compra, y wx no deja guardar dos
// veces la misma.
export async function guardarComprasDelLibro(
  compras: unknown
): Promise<ResultadoDeGuardarDelLibro> {
  try {
    if (modoDeEjecucion() !== 'local') return { guardado: false, errores: [SOLO_EN_LOCAL] };
    if (!Array.isArray(compras) || compras.length === 0 || !compras.every(esCompra)) {
      return { guardado: false, errores: [NO_LLEGARON_COMPRAS] };
    }
    const almacenamiento = obtenerAlmacenamiento();
    const { RNCEmisor } = await almacenamiento.leerEmisor();
    let guardadas = 0;
    const noGuardadas: string[] = [];
    for (const compra of compras) {
      const cual = `${compra.NCF} de ${compra.RNCCedula}`;
      const errores = validarCompra(compra, RNCEmisor);
      if (errores.length > 0) {
        noGuardadas.push(`${cual}: ${errores.join(' ')}`);
        continue;
      }
      try {
        await almacenamiento.guardarCompra(compra);
        guardadas += 1;
      } catch (error) {
        // El error de una compra duplicada ya dice cuál es.
        const motivo = mensaje(error);
        noGuardadas.push(motivo.includes(compra.NCF) ? motivo : `${cual}: ${motivo}`);
      }
    }
    if (guardadas > 0) refresh();
    return { guardado: true, guardadas, noGuardadas };
  } catch (error) {
    return { guardado: false, errores: [mensaje(error)] };
  }
}

/**
 * Descarga los esquemas XSD de e-CF desde el portal de DGII y los compara con
 * esquemas/MANIFIESTO.json.
 *
 * POR QUÉ EXISTE: DGII modifica esquemas sin un canal que un programa pueda
 * escuchar. Los de los tipos 33 y 34 cambiaron el 1 de abril de 2026, seis meses
 * después que el resto. Un validador que corre contra un XSD viejo aprueba XML
 * que DGII rechaza, y lo aprueba en verde.
 *
 * POR QUÉ LAS CABECERAS: el portal responde 403 al User-Agent de curl y de
 * fetch, y 200 al de un navegador. No es un bloqueo a scripts, es un filtro por
 * User-Agent. Durante un rato este proyecto dio por hecho lo primero y escribió
 * en su plan que los esquemas había que bajarlos a mano.
 *
 *   node scripts/bajar-esquemas.mjs               # comprueba; sale con 1 si algo cambió
 *   node scripts/bajar-esquemas.mjs --actualizar  # descarga y reescribe el manifiesto
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(RAIZ, 'esquemas');
const MANIFIESTO = join(DIR, 'MANIFIESTO.json');
// La página principal de facturación electrónica no enlaza los XSD. Esta sí.
const PAGINA =
  'https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Paginas/documentacionSobreE-CF.aspx';
const ACTUALIZAR = process.argv.includes('--actualizar');

const CABECERAS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Accept-Language': 'es-DO,es;q=0.9',
  Referer: PAGINA,
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const decodificar = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

async function obtener(url) {
  const res = await fetch(url, { headers: CABECERAS });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const html = (await obtener(PAGINA)).toString('utf8');

// Cada enlace trae en su texto "Modificado: dd/mm/aaaa". Es el único lugar donde
// DGII dice cuándo cambió un esquema; el archivo no lo lleva dentro.
const publicados = [];
for (const [, href, texto] of html.matchAll(/<a[^>]+href="([^"]+\.xsd)"[^>]*>([\s\S]*?)<\/a>/gi)) {
  const url = new URL(decodificar(href), 'https://dgii.gov.do').href;
  const archivo = decodeURIComponent(new URL(url).pathname.split('/').pop());
  const plano = texto.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const m = plano.match(/Modificado:\s*(\d{2})\/(\d{2})\/(\d{4})/);
  publicados.push({ archivo, url, modificado: m ? `${m[3]}-${m[2]}-${m[1]}` : null });
}

if (publicados.length === 0) {
  // Si la página cambia de estructura, el regex deja de encontrar enlaces, y
  // "no encontré esquemas" se vería igual que "nada cambió". No lo es.
  console.error('No encontré ningún .xsd en la página de DGII. La página cambió; revisar a mano.');
  process.exit(2);
}

const anterior = existsSync(MANIFIESTO)
  ? JSON.parse(readFileSync(MANIFIESTO, 'utf8'))
  : { esquemas: [] };
const pendientes = new Map(anterior.esquemas.map((e) => [e.archivo, e]));

const esquemas = [];
const cambios = [];
for (const p of publicados) {
  const datos = await obtener(p.url);
  const texto = datos.toString('utf8').replace(/^﻿/, '').trimStart();
  // Un 200 con una página de error dentro también es un 200.
  if (!texto.startsWith('<?xml') || !/<(xs|xsd):schema/.test(texto)) {
    throw new Error(`${p.archivo} no es un XSD: ${texto.slice(0, 80)}`);
  }
  const hash = sha256(datos);
  const previo = pendientes.get(p.archivo);
  if (!previo) cambios.push(`nuevo          ${p.archivo}`);
  else if (previo.sha256 !== hash) cambios.push(`modificado     ${p.archivo} (DGII: ${p.modificado})`);
  pendientes.delete(p.archivo);

  const tipo = p.archivo.match(/^e-CF (\d{2})/)?.[1] ?? p.archivo.split(' ')[0];
  esquemas.push({
    archivo: p.archivo,
    tipo,
    modificadoDGII: p.modificado,
    bytes: datos.length,
    sha256: hash,
    url: p.url,
  });
  if (ACTUALIZAR) writeFileSync(join(DIR, p.archivo), datos);
}
for (const archivo of pendientes.keys()) cambios.push(`retirado       ${archivo}`);

if (ACTUALIZAR) {
  writeFileSync(
    MANIFIESTO,
    JSON.stringify({ fuente: PAGINA, descargado: new Date().toISOString(), esquemas }, null, 2) + '\n'
  );
  console.log(`${esquemas.length} esquemas escritos. ${cambios.length ? `${cambios.length} cambio(s):` : 'Sin cambios.'}`);
  for (const c of cambios) console.log(`  ${c}`);
  process.exit(0);
}

// Y lo que hay en disco tiene que ser lo del manifiesto: un XSD editado a mano
// valida lo que quiso su editor, no lo que publicó DGII.
for (const e of anterior.esquemas) {
  const ruta = join(DIR, e.archivo);
  if (!existsSync(ruta)) cambios.push(`falta en disco ${e.archivo}`);
  else if (sha256(readFileSync(ruta)) !== e.sha256) cambios.push(`editado local  ${e.archivo}`);
}

if (cambios.length) {
  console.error(`${cambios.length} diferencia(s) entre DGII, el manifiesto y el disco:`);
  for (const c of cambios) console.error(`  ${c}`);
  console.error('\nRevisar y, si DGII publicó algo nuevo: node scripts/bajar-esquemas.mjs --actualizar');
  process.exit(1);
}
console.log(`${esquemas.length} esquemas, idénticos a los que publica DGII hoy.`);

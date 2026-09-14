import { generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import forge from 'node-forge';
import { leerCertificadoP12, type Credencial } from './ecf/firma';
import type { Modo } from './storage';

// La demostración firma con un certificado autofirmado hecho en el momento: no tiene valor
// fiscal ni es la identidad de nadie. Cada llamada genera uno nuevo, así que no hay una
// llave de demostración guardada en ningún lado.
export function crearCredencialDeDemostracion(): Credencial {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const llavePrivada = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const certificado = forge.pki.createCertificate();
  certificado.publicKey = forge.pki.publicKeyFromPem(
    publicKey.export({ type: 'spki', format: 'pem' }).toString()
  );
  certificado.serialNumber = '01';
  certificado.validity.notBefore = new Date();
  certificado.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  const sujeto = [
    {
      name: 'commonName',
      value: 'Certificado de demostración: sin valor fiscal',
      // Sin esto forge escribe el nombre como PrintableString, que no admite la "ó", y el
      // certificado queda mal formado. @types/node-forge declara valueTagClass como
      // asn1.Class, pero forge lo usa como el tipo ASN.1 del valor.
      valueTagClass: forge.asn1.Type.UTF8 as unknown as forge.asn1.Class,
    },
  ];
  certificado.setSubject(sujeto);
  certificado.setIssuer(sujeto);
  certificado.sign(forge.pki.privateKeyFromPem(llavePrivada), forge.md.sha256.create());
  return { llavePrivada, certificado: forge.pki.certificateToPem(certificado) };
}

// En local, el certificado es datos/certificado.p12 y su clave va en CERTIFICADO_CLAVE,
// en .env.local, que git ignora. Nunca en el repo.
export async function leerCredencialLocal(
  directorio = join(process.cwd(), 'datos'),
  entorno: Record<string, string | undefined> = process.env
): Promise<Credencial> {
  const ruta = join(directorio, 'certificado.p12');
  let bytes: Buffer;
  try {
    bytes = await readFile(ruta);
  } catch (error) {
    throw new Error(
      `No hay ${ruta}: es el certificado digital que emite una entidad de certificación autorizada.`,
      { cause: error }
    );
  }
  const clave = entorno.CERTIFICADO_CLAVE;
  if (!clave) throw new Error('Falta CERTIFICADO_CLAVE: la clave de certificado.p12, en .env.local.');
  return leerCertificadoP12(bytes, clave);
}

let credencialDeDemostracion: Credencial | undefined;

// La credencial sale del modo y de nada más. En local no hay plan B: sin certificado.p12 no
// se firma, porque la de demostración guardaría en datos/ comprobantes con una firma sin valor.
export async function obtenerCredencial(
  modo: Modo,
  directorio = join(process.cwd(), 'datos'),
  entorno: Record<string, string | undefined> = process.env
): Promise<Credencial> {
  if (modo === 'demostracion') {
    credencialDeDemostracion ??= crearCredencialDeDemostracion();
    return credencialDeDemostracion;
  }
  return leerCredencialLocal(directorio, entorno);
}

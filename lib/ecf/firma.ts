import { createHash, sign, X509Certificate } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import forge from 'node-forge';
import { C14nCanonicalization, SignedXml } from 'xml-crypto';

// Firmado de e-CF (esquemas/docs/Firmado-de-e-CF.pdf): XMLDSig enveloped sobre todo el
// documento. Las URI salen de los ejemplos de código del PDF; el XML de ejemplo de la
// pág. 3 escribe mal tres de ellas.
const DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';

export interface Credencial {
  // PEM las dos.
  llavePrivada: string;
  certificado: string;
}

// El .p12 entra como bytes: leerlo del disco no le toca al motor.
export function leerCertificadoP12(p12: Uint8Array, clave: string): Credencial {
  let almacen: forge.pkcs12.Pkcs12Pfx;
  try {
    const der = forge.util.binary.raw.encode(p12);
    almacen = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), false, clave);
  } catch (error) {
    throw new Error(
      `No se pudo abrir el .p12: la clave no es la correcta o el archivo está dañado (${(error as Error).message}).`
    );
  }
  const { oids } = forge.pki;
  const llave = (almacen.getBags({ bagType: oids.pkcs8ShroudedKeyBag })[oids.pkcs8ShroudedKeyBag]?.[0]
    ?.key ?? almacen.getBags({ bagType: oids.keyBag })[oids.keyBag]?.[0]?.key) as
    | forge.pki.rsa.PrivateKey
    | undefined;
  if (!llave) throw new Error('El .p12 no trae una llave privada.');

  // Los .p12 de las entidades certificadoras traen la cadena: el que sirve es el de la llave.
  const certificado = (almacen.getBags({ bagType: oids.certBag })[oids.certBag] ?? [])
    .map((bolsa) => bolsa.cert)
    .find(
      (candidato) =>
        candidato !== undefined &&
        (candidato.publicKey as forge.pki.rsa.PublicKey).n.equals(llave.n)
    );
  if (!certificado) throw new Error('El .p12 no trae el certificado de su llave privada.');

  return {
    llavePrivada: forge.pki.privateKeyToPem(llave),
    certificado: forge.pki.certificateToPem(certificado),
  };
}

function canonico(xml: string): string {
  const fallar = (mensaje: string) => {
    throw new Error(`XML mal formado: ${mensaje}`);
  };
  const documento = new DOMParser({
    errorHandler: { warning: () => undefined, error: fallar, fatalError: fallar },
  }).parseFromString(xml, 'text/xml');
  return new C14nCanonicalization().process(documento.documentElement, {});
}

function verifica(firmado: string, firma: string, certificado: string): boolean {
  const verificador = new SignedXml({ publicCert: certificado });
  verificador.loadSignature(firma);
  try {
    return verificador.checkSignature(firmado);
  } catch {
    return false;
  }
}

export function firmarECF(xml: string, { llavePrivada, certificado }: Credencial): string {
  if (!/^(<\?xml[^>]*\?>)?<ECF>/.test(xml) || !/<\/ECF>\s*$/.test(xml)) {
    throw new Error('Solo se firma un e-CF: el elemento raíz tiene que ser ECF.');
  }
  if (xml.includes(`<Signature xmlns="${DSIG}"`)) throw new Error('El e-CF ya trae una firma.');

  // Con URI vacío, el digest es el del documento entero en forma canónica. No el de una
  // serialización, que es lo que xml-crypto 6.1.2 digiere al firmar (plan, Tarea 8).
  const digest = createHash('sha256').update(canonico(xml)).digest('base64');
  const signedInfo =
    `<SignedInfo><CanonicalizationMethod Algorithm="${C14N}"/>` +
    `<SignatureMethod Algorithm="${RSA_SHA256}"/>` +
    `<Reference URI=""><Transforms><Transform Algorithm="${ENVELOPED}"/></Transforms>` +
    `<DigestMethod Algorithm="${SHA256}"/><DigestValue>${digest}</DigestValue></Reference>` +
    '</SignedInfo>';

  // SignedInfo se canonicaliza como queda dentro de Signature, que le da su xmlns.
  const signedInfoCanonico = canonico(
    signedInfo.replace('<SignedInfo>', `<SignedInfo xmlns="${DSIG}">`)
  );
  const valor = sign('sha256', Buffer.from(signedInfoCanonico), llavePrivada).toString('base64');
  const certificadoBase64 = new X509Certificate(certificado).raw.toString('base64');
  const firma =
    `<Signature xmlns="${DSIG}">${signedInfo}<SignatureValue>${valor}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${certificadoBase64}</X509Certificate></X509Data>` +
    '</KeyInfo></Signature>';
  const cierre = xml.lastIndexOf('</ECF>');
  const firmado = xml.slice(0, cierre) + firma + xml.slice(cierre);

  // Una firma que nunca se verificó no sale de aquí: si la llave no es la del certificado,
  // se nota ahora y no en manos de DGII.
  if (!verifica(firmado, firma, certificado)) {
    throw new Error('La firma no verifica: la llave privada no corresponde al certificado.');
  }
  return firmado;
}

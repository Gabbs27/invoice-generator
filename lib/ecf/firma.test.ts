import { describe, it, expect, beforeAll } from 'vitest';
import { createHash, generateKeyPairSync, sign, verify, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
import { validateXML } from 'xmllint-wasm';
import { firmarECF, leerCertificadoP12, type Credencial } from './firma';
import { validarContraXSD } from './validar';
import { construirXML, type Comprobante, type ItemComprobante } from './xml';

const DSIG = 'http://www.w3.org/2000/09/xmldsig#';

// Las llaves y los certificados se generan aquí: el repo no guarda material de firma.
function certificadoPara(
  llavePublica: string,
  sujeto: string,
  emisor: string,
  firmante: forge.pki.rsa.PrivateKey
): forge.pki.Certificate {
  const certificado = forge.pki.createCertificate();
  certificado.publicKey = forge.pki.publicKeyFromPem(llavePublica);
  certificado.serialNumber = '01';
  certificado.validity.notBefore = new Date();
  certificado.validity.notAfter = new Date(Date.now() + 86_400_000);
  certificado.setSubject([{ name: 'commonName', value: sujeto }]);
  certificado.setIssuer([{ name: 'commonName', value: emisor }]);
  certificado.sign(firmante, forge.md.sha256.create());
  return certificado;
}

function crearIdentidad(nombre: string) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const llavePrivada = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const llavePublica = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const llaveForge = forge.pki.privateKeyFromPem(llavePrivada);
  const certificado = certificadoPara(llavePublica, nombre, nombre, llaveForge);
  return { llavePrivada, llavePublica, llaveForge, certificado };
}

function p12(
  llave: forge.pki.rsa.PrivateKey,
  certificados: forge.pki.Certificate[],
  clave: string,
  algoritmo: 'aes256' | '3des'
): Uint8Array {
  const asn1 = forge.pkcs12.toPkcs12Asn1(llave, certificados, clave, { algorithm: algoritmo });
  return Uint8Array.from(forge.asn1.toDer(asn1).getBytes(), (caracter) => caracter.charCodeAt(0));
}

const extraerFirma = (xml: string) =>
  xml.match(/<Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">[\s\S]*<\/Signature>/)?.[0] ??
  '';
const valorDe = (firma: string, etiqueta: string) =>
  firma.match(new RegExp(`<${etiqueta}>([^<]+)</${etiqueta}>`))?.[1] ?? '';

function verificaConXmlCrypto(firmado: string, certificado: string): boolean {
  const verificador = new SignedXml({ publicCert: certificado });
  verificador.loadSignature(extraerFirma(firmado));
  try {
    return verificador.checkSignature(firmado);
  } catch {
    return false;
  }
}

// Una segunda opinión que no pasa por xml-crypto: la canonicalización de libxml2 y el
// crypto de Node.
async function verificaConLibxml2(firmado: string, certificado: string) {
  const c14n = async (xml: string) =>
    (await validateXML({ xml, normalization: 'c14n' })).normalized.replace(/\n$/, '');
  const firma = extraerFirma(firmado);
  const digest = createHash('sha256')
    .update(await c14n(firmado.replace(firma, '')))
    .digest('base64');
  const signedInfo =
    firma
      .match(/<SignedInfo>[\s\S]*<\/SignedInfo>/)?.[0]
      .replace('<SignedInfo>', `<SignedInfo xmlns="${DSIG}">`) ?? '';
  const firmaRSA = Buffer.from(valorDe(firma, 'SignatureValue'), 'base64');
  return {
    digest: digest === valorDe(firma, 'DigestValue'),
    rsa: verify('sha256', Buffer.from(await c14n(signedInfo)), certificado, firmaRSA),
  };
}

const emisor = {
  RNCEmisor: '123456789',
  RazonSocialEmisor: 'Comercial Ejemplo SRL',
  DireccionEmisor: 'Calle Primera 1, Santo Domingo',
  FechaEmision: '12-09-2026',
};

const item: ItemComprobante = {
  NombreItem: 'Resma de papel',
  IndicadorBienoServicio: 1,
  CantidadItem: '2',
  PrecioUnitarioItem: '250.00',
  IndicadorFacturacion: 1,
};

const factura32: Comprobante = {
  eNCF: 'E320000000001',
  IndicadorMontoGravado: 1,
  TipoIngresos: '01',
  TipoPago: 1,
  Emisor: emisor,
  Items: [item],
  FechaHoraFirma: '12-09-2026 10:30:00',
};

const xml31 = construirXML({
  ...factura32,
  eNCF: 'E310000000001',
  FechaVencimientoSecuencia: '31-12-2027',
  Comprador: { RNCComprador: '987654321', RazonSocialComprador: 'Cliente Ejemplo SA' },
});
const xml32 = construirXML(factura32);
const xml32ConComillas = construirXML({
  ...factura32,
  Items: [{ ...item, NombreItem: 'Café & "té" <frío> \'sí\'' }],
});

let identidad: ReturnType<typeof crearIdentidad>;
let credencial: Credencial;

beforeAll(() => {
  identidad = crearIdentidad('Prueba e-CF');
  credencial = {
    llavePrivada: identidad.llavePrivada,
    certificado: forge.pki.certificateToPem(identidad.certificado),
  };
});

describe('firma XMLDSig del e-CF', () => {
  it('firma con la estructura exacta del Firmado de e-CF', () => {
    const firma = extraerFirma(firmarECF(xml32, credencial));
    const certificadoBase64 = new X509Certificate(credencial.certificado).raw.toString('base64');
    expect(firma).toBe(
      `<Signature xmlns="${DSIG}"><SignedInfo>` +
        '<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>' +
        '<SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>' +
        '<Reference URI=""><Transforms>' +
        '<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>' +
        '</Transforms><DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>' +
        `<DigestValue>${valorDe(firma, 'DigestValue')}</DigestValue></Reference></SignedInfo>` +
        `<SignatureValue>${valorDe(firma, 'SignatureValue')}</SignatureValue>` +
        `<KeyInfo><X509Data><X509Certificate>${certificadoBase64}</X509Certificate></X509Data>` +
        '</KeyInfo></Signature>'
    );
  });

  it('pone la firma como último hijo de ECF y no toca nada más', () => {
    const firmado = firmarECF(xml31, credencial);
    expect(firmado.endsWith('</Signature></ECF>')).toBe(true);
    expect(firmado.replace(extraerFirma(firmado), '')).toBe(xml31);
  });

  it.each([
    ['31', xml31],
    ['32, con el Comprador vacío que rompía a xml-crypto', xml32],
    ['32, con & " < > \' en un nombre', xml32ConComillas],
  ])('la firma del %s verifica con xml-crypto y, aparte, con libxml2', async (_nombre, xml) => {
    const firmado = firmarECF(xml, credencial);
    expect(verificaConXmlCrypto(firmado, credencial.certificado)).toBe(true);
    expect(await verificaConLibxml2(firmado, credencial.certificado)).toEqual({
      digest: true,
      rsa: true,
    });
  });

  it('el XML firmado valida contra el XSD', async () => {
    const esquema = (archivo: string) => readFileSync(`esquemas/${archivo}`, 'utf8');
    const firmado31 = firmarECF(xml31, credencial);
    const firmado32 = firmarECF(xml32, credencial);
    expect((await validarContraXSD(firmado31, esquema('e-CF 31 v.1.0.xsd'))).valido).toBe(true);
    expect((await validarContraXSD(firmado32, esquema('e-CF 32 v.1.0.xsd'))).valido).toBe(true);
  });

  // Control: una firma que no nota un documento alterado no sirve para nada.
  it('deja de verificar si alguien cambia un monto después de firmar', async () => {
    const firmado = firmarECF(xml32, credencial);
    const alterado = firmado.replace(/<MontoTotal>[^<]+<\/MontoTotal>/, '<MontoTotal>1.00</MontoTotal>');
    expect(alterado).not.toBe(firmado);
    expect(verificaConXmlCrypto(alterado, credencial.certificado)).toBe(false);
    expect((await verificaConLibxml2(alterado, credencial.certificado)).digest).toBe(false);
  });

  it('se niega a firmar con una llave que no es la del certificado', () => {
    const otra = crearIdentidad('Otra persona');
    expect(() =>
      firmarECF(xml32, { llavePrivada: otra.llavePrivada, certificado: credencial.certificado })
    ).toThrow(/no corresponde/);
  });

  it('se niega a firmar un e-CF que ya trae firma', () => {
    expect(() => firmarECF(firmarECF(xml32, credencial), credencial)).toThrow(/ya trae una firma/);
  });

  it('se niega a firmar algo que no es un e-CF', () => {
    expect(() => firmarECF('<Factura></Factura>', credencial)).toThrow(/ECF/);
  });
});

describe('certificado .p12', () => {
  it.each(['aes256', '3des'] as const)('abre un .p12 cifrado con %s', (algoritmo) => {
    const bytes = p12(identidad.llaveForge, [identidad.certificado], 'clave-de-prueba', algoritmo);
    const leida = leerCertificadoP12(bytes, 'clave-de-prueba');
    expect(new X509Certificate(leida.certificado).fingerprint256).toBe(
      new X509Certificate(credencial.certificado).fingerprint256
    );
    const mensaje = Buffer.from('prueba de firma');
    expect(verify('sha256', mensaje, leida.certificado, sign('sha256', mensaje, leida.llavePrivada))).toBe(
      true
    );
  });

  it('rechaza una clave equivocada', () => {
    const bytes = p12(identidad.llaveForge, [identidad.certificado], 'clave-de-prueba', 'aes256');
    expect(() => leerCertificadoP12(bytes, 'otra-clave')).toThrow(/clave/);
  });

  // Los .p12 de las entidades certificadoras traen la cadena, y el primer certificado no
  // siempre es el del titular.
  it('elige el certificado de la llave aunque el .p12 traiga la cadena delante', () => {
    const autoridad = crearIdentidad('Autoridad de prueba');
    const titular = crearIdentidad('Titular');
    const certificadoTitular = certificadoPara(
      titular.llavePublica,
      'Titular',
      'Autoridad de prueba',
      autoridad.llaveForge
    );
    const bytes = p12(titular.llaveForge, [autoridad.certificado, certificadoTitular], 'clave', 'aes256');
    expect(new X509Certificate(leerCertificadoP12(bytes, 'clave').certificado).subject).toBe(
      'CN=Titular'
    );
  });
});

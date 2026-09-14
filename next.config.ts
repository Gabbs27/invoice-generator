import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // xmllint-wasm lee xmllint.wasm de su propia carpeta. Empaquetado, no lo encuentra y la
  // validación falla: "ENOENT: no such file or directory, open
  // '/ROOT/node_modules/xmllint-wasm/xmllint.wasm'".
  serverExternalPackages: ['xmllint-wasm'],
  // El trazado sigue las rutas que arman lib/credencial.ts y lib/storage: sin esto, el
  // servidor construido se lleva datos/certificado.p12 y datos/emisor.json de la máquina
  // donde se construye. Los PDF de esquemas/docs tampoco hacen falta para emitir.
  outputFileTracingExcludes: {
    '/*': ['./datos/**/*', './esquemas/docs/**/*'],
  },
};

export default nextConfig;

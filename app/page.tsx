import type { ReactNode } from 'react';
import { connection } from 'next/server';
import { construirENCF } from '@/lib/ecf/encf';
import type { TipoECF } from '@/lib/ecf/tipos';
import { modoDeEjecucion, obtenerAlmacenamiento, type Modo } from '@/lib/storage';
import type { Almacenamiento } from '@/lib/storage/tipos';
import { Emision } from './emision';
import estilos from './pagina.module.css';

const EJEMPLO_DE_EMISOR = `{
  "RNCEmisor": "123456789",
  "RazonSocialEmisor": "Tu razón social",
  "DireccionEmisor": "Tu dirección",
  "rangos": {
    "31": { "desde": 1, "hasta": 100, "FechaVencimientoSecuencia": "31-12-2027" },
    "32": { "desde": 1, "hasta": 100, "FechaVencimientoSecuencia": "31-12-2027" }
  }
}`;

async function proximoENCF(almacenamiento: Almacenamiento, tipo: TipoECF) {
  try {
    return { tipo, eNCF: construirENCF(tipo, await almacenamiento.proximaSecuencia(tipo)) };
  } catch (error) {
    return { tipo, aviso: (error as Error).message };
  }
}

export default async function Pagina() {
  // El emisor y lo emitido se leen en cada visita: nada de esto se prerenderiza.
  await connection();
  const modo = modoDeEjecucion();
  const almacenamiento = obtenerAlmacenamiento();
  const emisor = await almacenamiento.leerEmisor().catch((error: Error) => error);
  const proximos =
    emisor instanceof Error
      ? []
      : await Promise.all((['31', '32'] as const).map((tipo) => proximoENCF(almacenamiento, tipo)));

  return (
    <main className={estilos.hoja}>
      <header className={estilos.membrete}>
        <div>
          <p className={estilos.antetitulo}>Comprobante fiscal electrónico</p>
          <h1 className={estilos.titulo}>
            Emitir <em>e-CF</em>
          </h1>
        </div>
        <AvisoDeModo modo={modo} />
      </header>

      {emisor instanceof Error ? (
        <section className={estilos.sinEmisor}>
          <h2>No se pudo leer el emisor</h2>
          <p>{emisor.message}</p>
          <p>Ese archivo lleva tus datos y los rangos que DGII te autorizó para cada tipo:</p>
          <pre>{EJEMPLO_DE_EMISOR}</pre>
        </section>
      ) : (
        <section className={estilos.emisor} aria-labelledby="titulo-emisor">
          <h2 id="titulo-emisor" className={estilos.oculto}>
            Emisor
          </h2>
          <dl className={estilos.datos}>
            <Dato nombre="RNC emisor" cifra>
              {emisor.RNCEmisor}
            </Dato>
            <Dato nombre="Razón social">{emisor.RazonSocialEmisor}</Dato>
            <Dato nombre="Dirección">{emisor.DireccionEmisor}</Dato>
            {proximos.map((proximo) =>
              proximo.eNCF !== undefined ? (
                <Dato key={proximo.tipo} nombre={`Próximo e-NCF ${proximo.tipo}`} cifra>
                  {proximo.eNCF}
                </Dato>
              ) : (
                <Dato key={proximo.tipo} nombre={`Próximo e-NCF ${proximo.tipo}`}>
                  <span className={estilos.aviso}>{proximo.aviso}</span>
                </Dato>
              )
            )}
          </dl>
        </section>
      )}

      <Emision modo={modo} habilitado={!(emisor instanceof Error)} />
    </main>
  );
}

function AvisoDeModo({ modo }: { modo: Modo }) {
  if (modo === 'demostracion') {
    return (
      <div className={estilos.modo}>
        <p className={estilos.sello}>Sin valor fiscal</p>
        <p className={estilos.notaDeModo}>
          Demostración: el emisor y el certificado son ficticios, y lo emitido vive en memoria
          hasta que el servidor se reinicia.
        </p>
      </div>
    );
  }
  return (
    <div className={estilos.modo}>
      <p className={estilos.chip}>Modo local</p>
      <p className={estilos.notaDeModo}>
        Guarda en <code>datos/</code> y firma con <code>datos/certificado.p12</code>.
      </p>
    </div>
  );
}

function Dato({
  nombre,
  cifra = false,
  children,
}: {
  nombre: string;
  cifra?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={estilos.dato}>
      <dt>{nombre}</dt>
      <dd className={cifra ? estilos.cifra : undefined}>{children}</dd>
    </div>
  );
}

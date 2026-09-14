import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Modo } from '@/lib/storage';
import estilos from './pagina.module.css';

const SECCIONES = [
  { ruta: '/', nombre: 'Emitir e-CF' },
  { ruta: '/compras', nombre: 'Compras y 606' },
] as const;

export function Membrete({
  actual,
  antetitulo,
  modo,
  children,
}: {
  actual: (typeof SECCIONES)[number]['ruta'];
  antetitulo: string;
  modo: Modo;
  children: ReactNode;
}) {
  return (
    <header className={estilos.membrete}>
      <div>
        <nav aria-label="Secciones" className={estilos.navegacion}>
          {SECCIONES.map(({ ruta, nombre }) => (
            <Link
              key={ruta}
              href={ruta}
              aria-current={ruta === actual ? 'page' : undefined}
              className={estilos.seccionDeNavegacion}
            >
              {nombre}
            </Link>
          ))}
        </nav>
        <p className={estilos.antetitulo}>{antetitulo}</p>
        <h1 className={estilos.titulo}>{children}</h1>
      </div>
      <AvisoDeModo modo={modo} />
    </header>
  );
}

function AvisoDeModo({ modo }: { modo: Modo }) {
  if (modo === 'demostracion') {
    return (
      <div className={estilos.modo}>
        <p className={estilos.sello}>Sin valor fiscal</p>
        <p className={estilos.notaDeModo}>
          Demostración: el emisor y el certificado son ficticios, y lo que se emite o se anota vive
          en memoria, a la vista de quien entre, hasta que el servidor se reinicia.
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

import type { ReactNode } from 'react';
import estilos from './emision.module.css';

// Piezas de formulario que comparten la página de emitir y la de compras.

export function Titulo({
  id,
  letra,
  nota,
  children,
}: {
  id: string;
  letra: string;
  nota?: string;
  children: ReactNode;
}) {
  return (
    <div className={estilos.titulo}>
      <span className={estilos.letra} aria-hidden="true">
        {letra}
      </span>
      <h2 id={id} className={estilos.nombre}>
        {children}
      </h2>
      <span className={estilos.regla} aria-hidden="true" />
      {nota && <p className={estilos.nota}>{nota}</p>}
    </div>
  );
}

// codigo es el nombre del campo en el documento de la DGII: el elemento del XSD en un e-CF, la
// casilla en el 606.
export function Campo({
  id,
  etiqueta,
  codigo,
  ayuda,
  children,
}: {
  id: string;
  etiqueta: string;
  codigo: string;
  ayuda?: string;
  children: ReactNode;
}) {
  return (
    <div className={estilos.campo}>
      <label htmlFor={id} className={estilos.etiqueta}>
        {etiqueta}
        <span className={estilos.xsd} aria-hidden="true">
          {codigo}
        </span>
      </label>
      {children}
      {ayuda && (
        <p id={`${id}-ayuda`} className={estilos.ayuda}>
          {ayuda}
        </p>
      )}
    </div>
  );
}

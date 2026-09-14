import type { Metadata } from 'next';
import { Atkinson_Hyperlegible_Next, Instrument_Serif, Spline_Sans_Mono } from 'next/font/google';
import './globals.css';

const titulares = Instrument_Serif({
  variable: '--fuente-titulares',
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
});

const texto = Atkinson_Hyperlegible_Next({ variable: '--fuente-texto', subsets: ['latin'] });

// Cifras de ancho fijo: los montos se alinean como en un libro de contabilidad.
const cifras = Spline_Sans_Mono({ variable: '--fuente-cifras', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Emisor e-CF',
  description:
    'Arma, firma y valida comprobantes fiscales electrónicos (e-CF) de República Dominicana.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="es-DO" className={`${titulares.variable} ${texto.variable} ${cifras.variable}`}>
      <body>{children}</body>
    </html>
  );
}

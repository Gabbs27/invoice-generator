import { probarContratoDeAlmacenamiento } from './contrato';
import { AlmacenamientoEnMemoria } from './memoria';

probarContratoDeAlmacenamiento('en memoria', async (emisor) => new AlmacenamientoEnMemoria(emisor));

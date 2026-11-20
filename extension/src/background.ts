// Service worker entry (50 section 7.1): every listener is registered synchronously at the top level.
import { register } from './sw/register';

register(chrome);

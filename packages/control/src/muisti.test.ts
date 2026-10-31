import { runControlConformance } from './conformance.js';
import { luoMuistiControlStore } from './muisti.js';

runControlConformance('@penni/control muisti', () => luoMuistiControlStore());

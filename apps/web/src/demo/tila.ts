/**
 * Julkinen selaindemo (`vite --mode demo`, ks. `demo:build`): sama sovellus muistissa olevalla
 * demokirjanpidolla. Mitään ei tallenneta eikä lähetetä minnekään — sivun lataus palauttaa demon.
 * `VITE_PENNI_DEMO=1` kytkee saman tilan muissakin build-moodeissa.
 */
export const DEMO = import.meta.env.MODE === 'demo' || import.meta.env.VITE_PENNI_DEMO === '1';

/** Penni-sivusto, jonne demosta palataan. */
export const KOTISIVU = 'https://penni.pro/';

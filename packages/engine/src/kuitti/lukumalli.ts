/**
 * Kuittien paikallinen lukumalli (näkömalli WebGPU:lla). Sama tunniste ja kiinnitetty revisio
 * selaimelle (lataus) ja työpöydän pääprosessille (mallivälimuistin sallittu lista).
 */
export const LUKUMALLI = {
  id: 'onnx-community/Qwen3.5-0.8B-ONNX',
  revisio: 'd1ea95774d40a29f0479bf9138cdf488a0394b6b',
} as const;

/** Kuvan pisin sivu ennen päättelyä: 768 px oli mittauksessa yhtä tarkka kuin 1024 px ja ~40 % nopeampi. */
export const KUVAN_MAKS_SIVU = 768;

/** Työpöydän mallivälimuistin URL-skeema (pääprosessin protocol.handle). */
export const MALLI_SKEEMA = 'penni-malli';

/**
 * Työpöydän isäntä, jonka kautta päättelytyöntekijän fetch-kääre ohjaa kiinnitetyn lukumallin
 * haut (transformers.js:n `env.remoteHost` pysyy https:nä). Polut: `<repo>/resolve/<revisio>/<tiedosto>`.
 */
export const MALLI_ISANTA = `${MALLI_SKEEMA}://hf/`;

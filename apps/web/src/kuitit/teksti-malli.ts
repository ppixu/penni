/**
 * Tekstimallin ajoasetukset PDF→teksti-polulle: pdf.js poimii digitaalisen PDF:n
 * tekstikerroksen tarkasti (ei mallia), ja tämä pieni tekstiä tuottava LLM muuntaa
 * poimitun tekstin Kuitti-JSONiksi. TEKSTI_MALLI_ID on vaihdettavissa kuten näkömallin
 * MALLI_ID (malli.ts). Kevyempi vaihtoehto 'onnx-community/Qwen2.5-0.5B-Instruct' (nopeampi,
 * mutta liian heikko — kopioi kehotteen paikkamerkit); 1.5B on selvästi luotettavampi JSON:ssa.
 */
export const TEKSTI_MALLI_ID = 'onnx-community/Qwen2.5-1.5B-Instruct';

export const TEKSTI_MALLI_DTYPE = 'q4';

export const TEKSTI_MALLI_LAITE = 'webgpu' as const;

export const TEKSTI_MAKS_UUDET_TOKENIT = 512;

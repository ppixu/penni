// Electronin ipcMain.handle kietoo heitetyn virheen viestin etuliitteeseen
// "Error invoking remote method '<kanava>': ..." ennen kuin renderöijä sen näkee — ks.
// apps/desktop/src/tasmaysSilta.ts. LukuVirhe-viestit ovat käyttäjän luettavaksi kirjoitettuja
// ohjeita ("käytä pankin Tapahtumat-vientiä"), joten IPC-putken oma etuliite pitää riisua pois
// ennen näyttämistä — muuten ohje hukkuu toteutuksen yksityiskohtaan.
const KANAVA_ETULIITE = /^Error invoking remote method '[^']*':\s*/;
const LUOKKA_ETULIITE = /^(?:Error|LukuVirhe):\s*/;

/**
 * Riisuu Electronin IPC-etuliitteen (ja sen mukana mahdollisesti tulevan virheluokan nimen
 * sekä pinolistauksen) virheviestistä. Viesti jolla etuliitettä ei ole, palautuu muuttumattomana:
 * tämän helperin läpi kulkee myös muita kuin sillan virheitä, eikä monirivistä viestiä saa
 * kutistaa ensimmäiseksi rivikseen — pinolistaus tulee vain IPC:n mukana.
 */
export function siivoaIpcVirhe(viesti: string): string {
  if (!KANAVA_ETULIITE.test(viesti)) return viesti.trim();
  const ilmanKanavaa = viesti.replace(KANAVA_ETULIITE, '');
  const ensimmainenRivi = ilmanKanavaa.split('\n')[0] ?? ilmanKanavaa;
  return ensimmainenRivi.replace(LUOKKA_ETULIITE, '').trim();
}

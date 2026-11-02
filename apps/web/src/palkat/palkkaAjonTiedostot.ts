import type { KpClient } from '@penni/asiakas';
import { type StoredTosite, TositeTyyppi } from '@penni/engine';
import { palkkatietoilmoitusXml } from '@penni/palkat';
import { palkkalaskelmaMalli, palkkalaskelmanNimi } from '@penni/palkka-pdf';
import {
  PalkkaAjoVirhe,
  haePalkkaAjot,
  haeTyontekija,
  luePalkkatiedot,
  maksajaAsetuksista,
  vuodenAlusta,
} from './palkkaAjoTiedot';

/**
 * Palkka-ajon ladattavat tiedostot. Molemmat muodostetaan aina uudelleen tositteen tilannekuvasta
 * ja työntekijärekisteristä (henkilötunnus, ammattiluokka, osoite, IBAN), joten sama ajo tuottaa
 * samat tavut. XML sisältää henkilötunnukset: sitä ei tallenneta eikä lokiteta.
 */

function vaadiPalkkaAjo(tosite: StoredTosite) {
  if (tosite.tyyppi !== TositeTyyppi.PALKKA || !tosite.palkka) {
    throw new PalkkaAjoVirhe('EI_PALKKA_AJO', 'Tosite ei ole palkka-ajo.');
  }
  return tosite.palkka;
}

/** Palkkatietoilmoitus (DeliveryDataType 100) tiedostona `palkkatietoilmoitus-<maksupäivä>.xml`. */
export async function palkkatietoilmoitus(
  client: KpClient,
  tosite: StoredTosite,
): Promise<{ nimi: string; xml: string }> {
  const ajo = vaadiPalkkaAjo(tosite);
  const tiedot = luePalkkatiedot(await client.haeAsetukset());
  const maksaja = maksajaAsetuksista(tiedot.asetukset, tiedot.palkatAsetukset);
  const xml = palkkatietoilmoitusXml({
    tositeId: tosite.id,
    maksupaiva: tosite.pvm,
    ajo,
    maksaja,
    tyontekijat: tiedot.tyontekijat,
    asetukset: tiedot.palkatAsetukset,
    // Tiedosto ladataan tuotannon lataus- ja tallennuspalveluun.
    tuotanto: true,
  });
  return { nimi: `palkkatietoilmoitus-${tosite.pvm}.xml`, xml };
}

/** Palkkalaskelmat, yksi PDF per henkilö (`palkkalaskelma-<sukunimi>-<maksupäivä>.pdf`). */
export async function palkkalaskelmat(
  client: KpClient,
  tosite: StoredTosite,
): Promise<{ nimi: string; pdf: Uint8Array }[]> {
  const ajo = vaadiPalkkaAjo(tosite);
  const tiedot = luePalkkatiedot(await client.haeAsetukset());
  const ajot = await haePalkkaAjot(client);
  const tyonantaja = {
    nimi: (tiedot.asetukset.Nimi ?? '').trim(),
    ytunnus: (tiedot.asetukset.Ytunnus ?? '').trim(),
  };
  // Dynaaminen import: PDF-kirjasto ja fontit eivät kuulu pääpaketin latausjonoon.
  const { rakennaPalkkalaskelmaPdf } = await import('@penni/palkka-pdf');
  const tulos: { nimi: string; pdf: Uint8Array }[] = [];
  for (const henkilo of ajo.henkilot) {
    const tyontekija = haeTyontekija(tiedot, henkilo.tyontekijaId);
    const malli = palkkalaskelmaMalli({
      henkilo,
      ajo,
      maksupaiva: tosite.pvm,
      tyontekija,
      tyonantaja,
      vuodenAlusta: vuodenAlusta(tosite, henkilo, ajot),
    });
    tulos.push({
      nimi: palkkalaskelmanNimi(henkilo.nimi, tosite.pvm),
      pdf: await rakennaPalkkalaskelmaPdf(malli),
    });
  }
  return tulos;
}

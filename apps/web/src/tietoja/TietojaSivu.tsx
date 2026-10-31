import { TopBar } from '@/components/shell/TopBar';
import { BetaMerkki } from '@/components/ui/BetaMerkki';
import {
  KITSAS,
  LISENSSI,
  LISENSSI_URL,
  SIVUSTO_URL,
  TEKIJANOIKEUS,
  YHTEYS_EMAIL,
} from '@penni/contract';
import type { ReactNode } from 'react';
import { LAHDEKOODI, VERSIO } from './tietoja.js';

const LINKKI = 'text-[var(--accent)] hover:underline';
const TEKSTI = 'text-[13px] leading-[1.55] text-[var(--text)]';

// Tavallinen <a href> ilman target="_blank": työpöytäsovellus estää uudet ikkunat ja avaa
// ulkoiset linkit käyttäjän luvalla järjestelmän selaimessa (apps/desktop, will-navigate).
function Ulkoinen({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} rel="noreferrer" className={LINKKI}>
      {children}
    </a>
  );
}

function Osio({ otsikko, children }: { otsikko: string; children: ReactNode }) {
  return (
    <div className="flex max-w-xl flex-col gap-2">
      <h2 className="text-[15px] font-[650]">{otsikko}</h2>
      {children}
    </div>
  );
}

/** Tietoja Pennistä: versio, tekijänoikeus, AGPL-lisenssi ja takuuttomuus, lähdekoodi, Kitsas. */
export function TietojaSivu() {
  return (
    <>
      <TopBar otsikko="Tietoja" alaotsikko="Penni" />
      <section
        aria-label="tietoja"
        className="flex flex-1 flex-col gap-8 overflow-auto px-[22px] py-5"
      >
        <div className="flex max-w-xl flex-col gap-2">
          <h2 className="flex items-center gap-2 text-[18px] font-[650]">
            Penni <BetaMerkki />
          </h2>
          <p className="text-[13px] text-[var(--text-muted)]">Kirjanpito omalla koneellasi.</p>
          <p className="text-[12.5px] tabular-nums text-[var(--text-subtle)]">Versio {VERSIO}</p>
          <p className={TEKSTI}>{TEKIJANOIKEUS}</p>
        </div>

        <Osio otsikko="Beta-versio">
          <p className={TEKSTI}>
            Penniä kehitetään aktiivisesti, eikä kirjanpidon ammattilainen ole tarkastanut sitä. Ota
            kirjanpitotiedostoistasi varmuuskopiot, tarkista luvut ennen kuin ilmoitat mitään
            eteenpäin, ja muista, että kirjanpitovelvollinen vastaa aina kirjanpidon
            oikeellisuudesta.
          </p>
        </Osio>

        <Osio otsikko="Lisenssi">
          <p className={TEKSTI}>
            Penni on vapaa ohjelmisto: voit levittää ja muokata sitä Free Software Foundationin
            julkaiseman <Ulkoinen href={LISENSSI_URL}>GNU Affero General Public License</Ulkoinen>
            -lisenssin version 3 tai (valintasi mukaan) minkä tahansa myöhemmän version ehtojen
            mukaisesti ({LISENSSI}).
          </p>
          <p className={TEKSTI}>
            Penniä levitetään siinä toivossa, että se olisi hyödyllinen, mutta{' '}
            <strong className="font-[650]">ilman minkäänlaista takuuta</strong>, ilman edes
            oletettua takuuta kaupallisesti hyväksyttävästä laadusta tai soveltuvuudesta tiettyyn
            tarkoitukseen. Lue tarkemmat ehdot lisenssistä.
          </p>
        </Osio>

        <Osio otsikko="Lähdekoodi">
          <p className={TEKSTI}>
            Pennin lähdekoodi on vapaasti saatavilla:{' '}
            <Ulkoinen href={LAHDEKOODI}>{LAHDEKOODI}</Ulkoinen>
          </p>
        </Osio>

        <Osio otsikko="Kitsas">
          <p className={TEKSTI}>
            Osa Pennistä pohjautuu{' '}
            <Ulkoinen href={KITSAS.url}>Kitsas-kirjanpito-ohjelmaan</Ulkoinen> (aiemmin Kitupiikki),{' '}
            {KITSAS.tekijanoikeus}, lisenssi {KITSAS.lisenssi}. Tilikarttadata on peräisin
            Kitsaasta, ja osa moottorista ja sen testeistä on käännetty Kitsaan lähdekoodista. Nämä
            osat ovat edelleen {KITSAS.lisenssi}-lisenssin alaisia.
          </p>
          <p className={TEKSTI}>
            Penni on itsenäinen, muokattu teos. Kitsas Oy ei ole Pennin tekijä eikä tue sitä, joten
            kysy Pennistä apua Pennin kehittäjältä.
          </p>
        </Osio>

        <Osio otsikko="Muut osat">
          <p className={TEKSTI}>
            Inter-kirjasin, © The Inter Project Authors, SIL Open Font License 1.1. Muut
            riippuvuudet ovat omien lisenssiensä alaisia.
          </p>
        </Osio>

        <Osio otsikko="Yhteystiedot">
          {/* Sähköposti tekstinä eikä mailto:-linkkinä: työpöytäsovellus päästää ulos vain
              http(s)-linkit (apps/desktop/src/navigointi.ts). */}
          <p className={TEKSTI}>
            <Ulkoinen href={SIVUSTO_URL}>penni.pro</Ulkoinen> · {YHTEYS_EMAIL}
          </p>
        </Osio>
      </section>
    </>
  );
}

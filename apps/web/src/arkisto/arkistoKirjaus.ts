/** Kauden arkistoinnin kirjaus asetuksissa: `Arkistoitu/<loppuu>` = JSON `{aika, tiiviste}`. */
export interface ArkistoKirjaus {
  aika: string;
  tiiviste: string;
}

export function arkistoKirjauksenAvain(loppuu: string): string {
  return `Arkistoitu/${loppuu}`;
}

/** Asetuksiin kirjattu arkistointi, jos luettavissa; vioittunut kirjaus ohitetaan. */
export function lueKirjaus(arvo: string | undefined): ArkistoKirjaus | null {
  if (!arvo) return null;
  try {
    const k = JSON.parse(arvo) as { aika?: unknown; tiiviste?: unknown };
    if (typeof k.aika === 'string' && typeof k.tiiviste === 'string') {
      return { aika: k.aika, tiiviste: k.tiiviste };
    }
  } catch {
    // Ei kirjausta.
  }
  return null;
}

/** Aikaleiman päivä paikallisessa ajassa ISO-muodossa (UTC-päivä voi olla eri vuorokausi). */
export function paikallinenPaiva(aika: string): string {
  const d = new Date(aika);
  if (Number.isNaN(d.getTime())) return aika.slice(0, 10);
  const kaksi = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${kaksi(d.getMonth() + 1)}-${kaksi(d.getDate())}`;
}

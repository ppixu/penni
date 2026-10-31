import { Link } from '@tanstack/react-router';
import { type ComponentProps, type ReactNode, createContext, useContext } from 'react';

/** Linkin kohde sellaisena kuin sovelluksen reitti ilmaisee sen. */
export type ArkistoLinkkiKohde = {
  to: string;
  params?: Record<string, string> | undefined;
  search?: Record<string, unknown> | undefined;
};

/**
 * Arkistoa renderöitäessä tämä konteksti kartoittaa sovelluslinkin arkistotiedoston
 * suhteelliseksi osoitteeksi, tai `null`:ksi, kun arkistossa ei ole kohdetta.
 */
export const ArkistoLinkitContext = createContext<
  ((kohde: ArkistoLinkkiKohde) => string | null) | null
>(null);

function olio<T extends object>(arvo: unknown): T | undefined {
  return typeof arvo === 'object' && arvo !== null ? (arvo as T) : undefined;
}

function LinkkiToteutus(props: ComponentProps<typeof Link>) {
  const kartta = useContext(ArkistoLinkitContext);
  if (!kartta) return <Link {...props} />;

  const href = kartta({
    to: typeof props.to === 'string' ? props.to : '',
    params: olio<Record<string, string>>(props.params),
    search: olio<Record<string, unknown>>(props.search),
  });
  const lapset: ReactNode = typeof props.children === 'function' ? null : props.children;
  return href === null ? (
    <span className={props.className as string | undefined}>{lapset}</span>
  ) : (
    <a href={href} className={props.className as string | undefined}>
      {lapset}
    </a>
  );
}

/**
 * Korvaa reitittimen `Link`in raporttikomponenteissa: sovelluksessa se on `Link`, arkiston
 * kontekstissa tavallinen `<a href>` arkistotiedostoon (tai `<span>`, ellei kohdetta ole).
 * Tyyppi on `Link`in oma, jotta `to`/`params`/`search` tarkistetaan reittipuuta vasten.
 */
export const Linkki = LinkkiToteutus as unknown as typeof Link;

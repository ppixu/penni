import { renderReitittimessa } from '@/test/renderReitittimessa';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ArkistoLinkitContext, type ArkistoLinkkiKohde, Linkki } from './Linkki';

const kartta = (k: ArkistoLinkkiKohde) =>
  k.to === '/tositteet/$id' ? `../tositteet/${k.params?.id}.html` : null;

describe('Linkki', () => {
  it('arkistokontekstissa renderöi tavallisen a-linkin arkistotiedostoon', () => {
    const { container } = render(
      <ArkistoLinkitContext.Provider value={kartta}>
        <Linkki to="/tositteet/$id" params={{ id: '5' }} className="x">
          T
        </Linkki>
      </ArkistoLinkitContext.Provider>,
    );
    const a = container.querySelector('a');
    expect(a?.getAttribute('href')).toBe('../tositteet/5.html');
    expect(a?.className).toBe('x');
    expect(a?.textContent).toBe('T');
  });

  it('arkistokontekstissa renderöi span-elementin, kun kohdetta ei ole', () => {
    const { container } = render(
      <ArkistoLinkitContext.Provider value={kartta}>
        <Linkki to="/tilikartta" search={{ nakyma: 'kaikki', tili: 1 }} className="y">
          x
        </Linkki>
      </ArkistoLinkitContext.Provider>,
    );
    expect(container.querySelector('a')).toBeNull();
    const span = container.querySelector('span');
    expect(span?.className).toBe('y');
    expect(span?.textContent).toBe('x');
  });

  it('välittää kartalle to-, params- ja search-arvot', () => {
    const saadut: ArkistoLinkkiKohde[] = [];
    render(
      <ArkistoLinkitContext.Provider
        value={(k) => {
          saadut.push(k);
          return null;
        }}
      >
        <Linkki to="/tilikartta" search={{ nakyma: 'kaikki', tili: 1 }}>
          x
        </Linkki>
      </ArkistoLinkitContext.Provider>,
    );
    expect(saadut).toEqual([
      { to: '/tilikartta', params: undefined, search: { nakyma: 'kaikki', tili: 1 } },
    ]);
  });

  it('ilman kontekstia toimii kuten reitittimen Link', async () => {
    await renderReitittimessa(
      <Linkki to="/tositteet/$id" params={{ id: '5' }}>
        T
      </Linkki>,
    );
    const a = await screen.findByRole('link', { name: 'T' });
    expect(a.getAttribute('href')).toMatch(/\/tositteet\/5$/);
  });
});

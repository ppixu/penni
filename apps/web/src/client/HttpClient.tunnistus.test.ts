import type { ApiFetcher } from '@ts-rest/core';
import { describe, expect, it, vi } from 'vitest';
import { HttpClient } from './HttpClient.js';

// FIX 1: mikä tahansa 401-vastaus mistä tahansa HttpClient-metodista laukaisee
// onTunnistusVanheni-callbackin (spec: "401 missä tahansa → tyhjennä token + takaisin kirjautumiseen").

describe('HttpClient – onTunnistusVanheni', () => {
  it('kutsutaan kun palvelin vastaa 401:llä, ja kutsu heittää silti virheen', async () => {
    const onTunnistusVanheni = vi.fn();
    const api: ApiFetcher = async () => ({
      status: 401,
      body: { virhe: 'Istunto vanhentunut', koodi: 'EI_SESSIOTA' },
      headers: new Headers(),
    });
    const client = new HttpClient({ baseUrl: 'http://kp.local', api, onTunnistusVanheni });

    await expect(client.haeInit()).rejects.toThrow();
    expect(onTunnistusVanheni).toHaveBeenCalledTimes(1);
  });

  it('ei kutsuta onnistuneessa kutsussa', async () => {
    const onTunnistusVanheni = vi.fn();
    const api: ApiFetcher = async () => ({
      status: 200,
      body: { asetukset: {}, tilit: [], tilikaudet: [], tositesarjat: [], kohdennukset: [] },
      headers: new Headers(),
    });
    const client = new HttpClient({ baseUrl: 'http://kp.local', api, onTunnistusVanheni });

    await client.haeInit();
    expect(onTunnistusVanheni).not.toHaveBeenCalled();
  });
});

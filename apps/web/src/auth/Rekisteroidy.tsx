import { Button } from '@/components/ui/button';
import { LahdekoodiHuomautus } from '@/tietoja/LahdekoodiHuomautus';
import { useState } from 'react';

const KENTTA =
  'w-full rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px]';

export function Rekisteroidy({
  onRekisteroi,
  onVaihdaKirjautumiseen,
}: {
  onRekisteroi: (syote: { email: string; salasana: string; nimi?: string }) => Promise<void>;
  onVaihdaKirjautumiseen: () => void;
}) {
  const [email, setEmail] = useState('');
  const [salasana, setSalasana] = useState('');
  const [nimi, setNimi] = useState('');
  const [virhe, setVirhe] = useState('');
  const [odottaa, setOdottaa] = useState(false);

  async function laheta(e: React.FormEvent) {
    e.preventDefault();
    setVirhe('');
    setOdottaa(true);
    try {
      await onRekisteroi({ email, salasana, ...(nimi ? { nimi } : {}) });
    } catch (err) {
      setVirhe(err instanceof Error ? err.message : 'Rekisteröinti epäonnistui');
      setOdottaa(false);
    }
  }

  return (
    <div className="mx-auto mt-24 flex w-[320px] flex-col gap-4">
      <h1 className="text-[18px] font-[650]">Luo Penni-tili</h1>
      <form className="flex flex-col gap-3" onSubmit={laheta}>
        <label className="flex flex-col gap-1 text-[12px]">
          Sähköposti
          <input
            className={KENTTA}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px]">
          Salasana
          <input
            className={KENTTA}
            type="password"
            value={salasana}
            onChange={(e) => setSalasana(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px]">
          Nimi
          <input
            className={KENTTA}
            type="text"
            value={nimi}
            onChange={(e) => setNimi(e.target.value)}
          />
        </label>
        {virhe && <p className="text-[12.5px] text-[var(--danger)]">{virhe}</p>}
        <Button type="submit" disabled={odottaa}>
          Rekisteröidy
        </Button>
      </form>
      <button
        type="button"
        className="text-[12.5px] text-[var(--text-muted)] underline"
        onClick={onVaihdaKirjautumiseen}
      >
        Onko sinulla jo tili? Kirjaudu
      </button>
      <LahdekoodiHuomautus />
    </div>
  );
}

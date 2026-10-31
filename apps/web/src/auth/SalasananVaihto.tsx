import { Button } from '@/components/ui/button';
import { useState } from 'react';

const KENTTA =
  'w-full max-w-sm rounded-[6px] border border-[var(--border-strong)] px-[10px] py-2 text-[13px]';

export function SalasananVaihto({
  onVaihda,
}: { onVaihda: (syote: { vanhaSalasana: string; uusiSalasana: string }) => Promise<void> }) {
  const [vanha, setVanha] = useState('');
  const [uusi, setUusi] = useState('');
  const [viesti, setViesti] = useState('');
  const [virhe, setVirhe] = useState('');

  async function laheta(e: React.FormEvent) {
    e.preventDefault();
    setViesti('');
    setVirhe('');
    try {
      await onVaihda({ vanhaSalasana: vanha, uusiSalasana: uusi });
      setViesti('Salasana vaihdettu');
      setVanha('');
      setUusi('');
    } catch (err) {
      setVirhe(err instanceof Error ? err.message : 'Salasanan vaihto epäonnistui');
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={laheta}>
      <h2 className="text-[15px] font-[650]">Vaihda salasana</h2>
      <label className="flex flex-col gap-1 text-[12px]">
        Nykyinen salasana
        <input
          className={KENTTA}
          type="password"
          value={vanha}
          onChange={(e) => setVanha(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-[12px]">
        Uusi salasana
        <input
          className={KENTTA}
          type="password"
          value={uusi}
          onChange={(e) => setUusi(e.target.value)}
        />
      </label>
      {viesti && <p className="text-[12.5px] text-[var(--text-muted)]">{viesti}</p>}
      {virhe && <p className="text-[12.5px] text-[var(--danger)]">{virhe}</p>}
      <div>
        <Button type="submit">Vaihda salasana</Button>
      </div>
    </form>
  );
}

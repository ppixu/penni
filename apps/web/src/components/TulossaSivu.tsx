import { TopBar } from '@/components/shell/TopBar';

export function TulossaSivu({ otsikko }: { otsikko: string }) {
  return (
    <>
      <TopBar otsikko={otsikko} />
      <section className="flex flex-1 items-center justify-center px-[22px] py-5">
        <p className="text-[13.5px] text-[var(--text-muted)]">Tulossa.</p>
      </section>
    </>
  );
}

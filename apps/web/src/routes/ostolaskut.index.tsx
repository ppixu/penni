import { createFileRoute, redirect } from '@tanstack/react-router';

// Tositteiden Menot-rajaus korvasi Ostolaskut-listan; syvälinkit ja kirjanmerkit pidetään elossa.
export const Route = createFileRoute('/ostolaskut/')({
  beforeLoad: () => {
    throw redirect({ to: '/tositteet', search: { laji: 'menot' } });
  },
});

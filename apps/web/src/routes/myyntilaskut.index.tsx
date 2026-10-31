import { createFileRoute, redirect } from '@tanstack/react-router';

// Tositteiden Tulot-rajaus korvasi Myyntilaskut-listan; syvälinkit ja kirjanmerkit pidetään elossa.
export const Route = createFileRoute('/myyntilaskut/')({
  beforeLoad: () => {
    throw redirect({ to: '/tositteet', search: { laji: 'tulot' } });
  },
});

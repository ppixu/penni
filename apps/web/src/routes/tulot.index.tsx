import { createFileRoute, redirect } from '@tanstack/react-router';

// Tulot yhdistettiin Tositteet-listaan (Kaikki/Tulot/Menot-rajaus). Syvälinkit ja
// kirjanmerkit pidetään elossa: ohjataan tositteisiin tulot-rajaus valittuna.
export const Route = createFileRoute('/tulot/')({
  beforeLoad: () => {
    throw redirect({ to: '/tositteet', search: { laji: 'tulot' } });
  },
});

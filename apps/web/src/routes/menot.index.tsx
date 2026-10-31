import { createFileRoute, redirect } from '@tanstack/react-router';

// Menot yhdistettiin Tositteet-listaan (Kaikki/Tulot/Menot-rajaus). Syvälinkit ja
// kirjanmerkit pidetään elossa: ohjataan tositteisiin menot-rajaus valittuna.
export const Route = createFileRoute('/menot/')({
  beforeLoad: () => {
    throw redirect({ to: '/tositteet', search: { laji: 'menot' } });
  },
});

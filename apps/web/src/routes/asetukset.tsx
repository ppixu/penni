import { AsetuksetSivu } from '@/asetukset/AsetuksetSivu';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/asetukset')({
  component: AsetuksetSivu,
});

import { TietojaSivu } from '@/tietoja/TietojaSivu';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/tietoja')({
  component: TietojaSivu,
});

import { KohdennuksetSivu } from '@/kohdennukset/KohdennuksetSivu';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/kohdennukset')({ component: KohdennuksetSivu });

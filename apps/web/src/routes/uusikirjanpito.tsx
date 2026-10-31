import { UusiKirjanpitoVelho } from '@/kirjanpito/UusiKirjanpitoVelho';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/uusikirjanpito')({ component: UusiKirjanpitoVelho });

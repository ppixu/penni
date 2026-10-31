import { TuontiNakyma } from '@/tuonti/TuontiNakyma';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/tuonti')({ component: TuontiNakyma });

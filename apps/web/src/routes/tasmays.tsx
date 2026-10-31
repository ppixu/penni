import { TasmaysNakyma } from '@/tasmays/TasmaysNakyma';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/tasmays')({ component: TasmaysNakyma });

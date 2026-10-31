import { KuittiArviointi } from '@/kuitit/KuittiArviointi';
import { luoPaattelija } from '@/kuitit/paattely';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

export const Route = createFileRoute('/kuitit/arviointi')({ component: Sivu });

function Sivu() {
  // Luodaan päättelijä (ja sen työntekijä) kerran, vasta selaimessa.
  const [paattelija] = useState(() => luoPaattelija());
  return <KuittiArviointi paattelija={paattelija} />;
}

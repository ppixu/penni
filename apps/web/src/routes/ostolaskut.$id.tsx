import { OstolaskuDetalji } from '@/ostolaskut/OstolaskuDetalji';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/ostolaskut/$id')({ component: OstolaskuNaytto });

function OstolaskuNaytto() {
  const { id } = Route.useParams();
  // Avain nollaa laskukohtaisen tilan (avoimet dialogit), kun Edellinen/Seuraava vaihtaa id:n.
  return <OstolaskuDetalji key={id} id={Number(id)} />;
}

import { useParams } from "react-router-dom";
import { AgentSendPanel } from "@/components/AgentSendPanel";

/** /agency/trips/:tripId/send — step 3 of "new trip from documents", as its own page. */
export default function AgentSendPage() {
  const { tripId } = useParams();
  return <AgentSendPanel tripId={tripId} />;
}

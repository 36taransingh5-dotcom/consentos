import { PixlyApp } from "@/components/pixly-app";
import { CONSENTOS_WEB_URL } from "@/lib/config";

export default function Home() {
  return <PixlyApp consentosUrl={CONSENTOS_WEB_URL} />;
}

import type { Metadata } from "next";
import { requireSessionUser } from "@/server/auth";
import { ConnectExtension } from "./connect-extension";

export const metadata: Metadata = { title: "Connect the extension" };

export default async function ConnectExtensionPage() {
  const user = await requireSessionUser("/extension/connect");
  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:py-24">
      <ConnectExtension email={user.email} />
    </div>
  );
}

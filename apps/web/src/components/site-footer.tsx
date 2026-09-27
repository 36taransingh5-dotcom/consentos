import Link from "next/link";
import { LogoMark } from "./logo";

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-[13px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="flex items-center gap-2">
          <LogoMark className="size-4 text-faint" />
          ConsentOS is a proposed open protocol. Pixly is its reference integration.
        </p>
        <ul className="flex flex-wrap gap-x-5 gap-y-2">
          <li>
            <Link href="/developers" className="hover:text-ink">
              Developers
            </Link>
          </li>
          <li>
            <a href="/api/v1/keys" className="hover:text-ink">
              Signing keys
            </a>
          </li>
          <li>
            <Link href="/extension/connect" className="hover:text-ink">
              Connect extension
            </Link>
          </li>
        </ul>
      </div>
    </footer>
  );
}

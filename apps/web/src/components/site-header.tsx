import Link from "next/link";
import { signOutAction } from "@/app/actions";
import { getSessionUser } from "@/server/auth";
import { Logo } from "./logo";
import { NavLinks } from "./nav-links";
import { buttonClass } from "./ui";

export async function SiteHeader() {
  const user = await getSessionUser();
  const links = user
    ? [
        { href: "/policy", label: "Rules" },
        { href: "/receipts", label: "Receipts" },
        { href: "/developers", label: "Developers" },
      ]
    : [{ href: "/developers", label: "Developers" }];

  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="rounded-md" aria-label="ConsentOS home">
          <Logo />
        </Link>
        <nav aria-label="Main" className="hidden flex-1 md:block">
          <NavLinks links={links} />
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <span className="hidden max-w-[220px] truncate text-[13px] text-muted lg:inline" title={user.email}>
                {user.email}
              </span>
              <form action={signOutAction}>
                <button type="submit" className={buttonClass("ghost", "sm")}>
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className={buttonClass("ghost", "sm")}>
                Sign in
              </Link>
              <Link href="/policy" className={buttonClass("primary", "sm", "hidden sm:inline-flex")}>
                Set my privacy rules
              </Link>
            </>
          )}
        </div>
      </div>
      <nav aria-label="Main (mobile)" className="border-t border-line/60 px-4 md:hidden">
        <NavLinks links={links} />
      </nav>
    </header>
  );
}

import clsx from "clsx";

const BRAND: Record<string, string> = { pixly: "#ff5a4e" };

export function ServiceAvatar({ id, name, className }: { id: string; name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={clsx("grid size-9 shrink-0 place-items-center rounded-xl text-[14px] font-bold text-white", className)}
      style={{ background: BRAND[id] ?? "#3a3a40" }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

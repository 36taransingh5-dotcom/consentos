import type { Exchange } from "@/lib/consentos";

/** One line in the protocol inspector. */
export interface LogEntry extends Exchange {
  /** What triggered it, in product terms: "Enable smart recommendations". */
  label: string;
  /** Who called whom. */
  hop: "pixly → consentos" | "browser → pixly";
}

export interface HttpResult {
  status: number;
  statusText: string;
  body: unknown;
}

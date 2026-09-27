import type { SignedReceipt } from "@consentos/shared";
import { z } from "zod";
import { asService } from "@/server/db";
import { clientAddress, handle, json, preflight, readJson } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { verifyReceiptDocument } from "@/server/receipts";

const documentSchema = z.object({
  payload: z.record(z.string(), z.unknown()),
  payloadHash: z.string().max(200),
  signature: z.string().max(200),
  algorithm: z.literal("Ed25519").optional(),
});

/**
 * POST /api/v1/receipts/verify — verify a receipt document you hold.
 *
 * Useful for services that archived a receipt, and for demonstrating tamper
 * detection: change any field and verification fails.
 */
export const POST = handle(
  async (req: Request) => {
    rateLimit(`verify-doc:${clientAddress(req)}`, 60, 60_000);
    const doc = await readJson(req, documentSchema);
    const receipt = { ...doc, algorithm: "Ed25519" } as unknown as SignedReceipt;
    return json(await asService((tx) => verifyReceiptDocument(tx, receipt)));
  },
  { cors: true },
);

export const OPTIONS = preflight;

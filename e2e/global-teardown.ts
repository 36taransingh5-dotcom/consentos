/**
 * Leave the demo account as a visitor would expect it: default rules, no
 * grants. Matters most for hosted runs against a shared public demo.
 */
export default async function globalTeardown() {
  const consentos = (process.env.E2E_CONSENTOS_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const token = process.env.E2E_DEMO_RESET_TOKEN ?? "cos_test_demo_reset_local_only";
  await fetch(`${consentos}/api/demo/reset`, { method: "POST", headers: { "x-consentos-demo-token": token } }).catch(
    () => undefined,
  );
}

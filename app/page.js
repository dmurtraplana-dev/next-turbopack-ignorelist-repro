import { createClient } from "side-effect-sdk";

// Reproduces: side-effect-sdk ships its own source maps (like most tsc-built packages).
export default async function Page() {
  const greeting = await createClient().getGreeting();
  return <p>{greeting}</p>;
}

export const dynamic = "force-dynamic";

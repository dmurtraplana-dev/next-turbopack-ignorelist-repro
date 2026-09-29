import { createClient } from "side-effect-sdk-nomap";

// Control: byte-identical package code, but it ships NO source maps. Does not reproduce.
export default async function Page() {
  const greeting = await createClient().getGreeting();
  return <p>{greeting}</p>;
}

export const dynamic = "force-dynamic";

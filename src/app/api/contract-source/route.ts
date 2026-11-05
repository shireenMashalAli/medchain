import { readFile } from "node:fs/promises";
import path from "node:path";

// Serves the Algorithm 08 module the app actually executes, so Contract Studio can show the real code.
export async function GET() {
  const source = await readFile(path.join(process.cwd(), "src", "lib", "contract.ts"), "utf8");
  return new Response(source, { headers: { "content-type": "text/plain; charset=utf-8" } });
}

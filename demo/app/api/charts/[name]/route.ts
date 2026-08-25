import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("..") ||
    !name.endsWith(".png")
  ) {
    return new Response("Not found", { status: 404 });
  }
  const chartsOut = process.env.CHARTS_OUT;
  if (!chartsOut) {
    return new Response("CHARTS_OUT not configured", { status: 500 });
  }
  try {
    const buf = await readFile(join(chartsOut, name));
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

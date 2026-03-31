/**
 * /api/convictions/[ticker]/route.ts
 * DELETE: soft-delete (retire) a conviction for a specific ticker
 */

import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function DELETE(
  _req: Request,
  props: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await props.params;
  const user = await prisma.user.findFirst();
  if (!user) return NextResponse.json({ error: "No user" }, { status: 404 });

  await prisma.userConviction.updateMany({
    where: { userId: user.id, ticker: ticker.toUpperCase(), active: true },
    data: { active: false },
  });

  return NextResponse.json({ ok: true });
}

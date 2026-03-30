import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.notificationRecipient.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

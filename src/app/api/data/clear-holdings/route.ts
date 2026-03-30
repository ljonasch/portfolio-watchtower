import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function DELETE() {
  const user = await prisma.user.findFirst();
  if (!user) return NextResponse.json({ error: "No user" }, { status: 404 });

  // Cascade deletes: holdings → reports → recommendations are all cascaded in schema
  const deleted = await prisma.portfolioSnapshot.deleteMany({ where: { userId: user.id } });

  return NextResponse.json({ ok: true, deleted: deleted.count });
}

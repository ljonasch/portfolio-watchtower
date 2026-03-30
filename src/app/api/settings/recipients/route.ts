import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { email, label } = await req.json();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  const user = await prisma.user.findFirst();
  if (!user) return NextResponse.json({ error: "No user" }, { status: 404 });

  const existing = await prisma.notificationRecipient.findFirst({ where: { userId: user.id, email } });
  if (existing) return NextResponse.json({ error: "Already added" }, { status: 409 });

  const recipient = await prisma.notificationRecipient.create({
    data: { userId: user.id, email, label: label ?? "Primary", active: true },
  });
  return NextResponse.json(recipient);
}

import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const body = await req.json();
  await prisma.appSettings.upsert({
    where: { key: "notification_settings" },
    create: { key: "notification_settings", value: JSON.stringify(body) },
    update: { value: JSON.stringify(body) },
  });
  return NextResponse.json({ ok: true });
}

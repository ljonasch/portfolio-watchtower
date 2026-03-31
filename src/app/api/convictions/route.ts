/**
 * /api/convictions/route.ts
 * GET: fetch all active convictions for current user
 * POST: create or update a conviction for a ticker
 */

import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  const user = await prisma.user.findFirst();
  if (!user) return NextResponse.json({ convictions: [] });

  const convictions = await prisma.userConviction.findMany({
    where: { userId: user.id, active: true },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ convictions });
}

export async function POST(req: Request) {
  const user = await prisma.user.findFirst();
  if (!user) return NextResponse.json({ error: "No user" }, { status: 404 });

  const { ticker, rationale } = await req.json();
  if (!ticker || typeof ticker !== "string") {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  // Upsert: update existing active conviction or create new one
  const existing = await prisma.userConviction.findFirst({
    where: { userId: user.id, ticker: ticker.toUpperCase(), active: true },
  });

  let conviction;
  if (existing) {
    conviction = await prisma.userConviction.update({
      where: { id: existing.id },
      data: { rationale: rationale ?? "", updatedAt: new Date() },
    });
  } else {
    conviction = await prisma.userConviction.create({
      data: {
        userId: user.id,
        ticker: ticker.toUpperCase(),
        rationale: rationale ?? "",
        active: true,
      },
    });
  }

  return NextResponse.json({ conviction });
}

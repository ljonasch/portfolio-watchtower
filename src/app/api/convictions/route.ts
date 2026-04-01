/**
 * GET  /api/convictions        — fetch all active convictions + full message threads
 * POST /api/convictions        — create or update a conviction (seeds first user message)
 */

import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const MESSAGE_INCLUDE = {
  messages: { orderBy: { createdAt: "asc" as const } },
};

export async function GET() {
  const user = await prisma.user.findFirst();
  if (!user) return NextResponse.json({ convictions: [] });

  const convictions = await prisma.userConviction.findMany({
    where: { userId: user.id, active: true },
    orderBy: { updatedAt: "desc" },
    include: MESSAGE_INCLUDE,
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

  const upperTicker = ticker.toUpperCase();
  const existing = await prisma.userConviction.findFirst({
    where: { userId: user.id, ticker: upperTicker, active: true },
    include: MESSAGE_INCLUDE,
  });

  let conviction;

  if (existing) {
    // Update the rationale bridge field; add a new user message to the thread
    conviction = await prisma.userConviction.update({
      where: { id: existing.id },
      data: {
        rationale: rationale ?? "",
        updatedAt: new Date(),
        messages: {
          create: {
            role: "user",
            content: rationale ?? "",
          },
        },
      },
      include: MESSAGE_INCLUDE,
    });
  } else {
    // Create conviction + seed first user message from the initial rationale
    conviction = await prisma.userConviction.create({
      data: {
        userId: user.id,
        ticker: upperTicker,
        rationale: rationale ?? "",
        active: true,
        messages: {
          create: {
            role: "user",
            content: rationale ?? "",
          },
        },
      },
      include: MESSAGE_INCLUDE,
    });
  }

  return NextResponse.json({ conviction });
}

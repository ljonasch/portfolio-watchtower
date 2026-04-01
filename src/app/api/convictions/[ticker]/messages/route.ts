/**
 * POST /api/convictions/[ticker]/messages
 * Adds a user reply message to an existing conviction thread.
 */

import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST(
  req: Request,
  props: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await props.params;
  const user = await prisma.user.findFirst();
  if (!user) return NextResponse.json({ error: "No user" }, { status: 404 });

  const { content } = await req.json();
  if (!content?.trim()) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  const conviction = await prisma.userConviction.findFirst({
    where: { userId: user.id, ticker: ticker.toUpperCase(), active: true },
  });

  if (!conviction) {
    return NextResponse.json({ error: "Conviction not found" }, { status: 404 });
  }

  const message = await prisma.convictionMessage.create({
    data: {
      convictionId: conviction.id,
      role: "user",
      content: content.trim(),
    },
  });

  // Keep rationale bridge in sync with most recent user statement
  await prisma.userConviction.update({
    where: { id: conviction.id },
    data: { rationale: content.trim(), updatedAt: new Date() },
  });

  return NextResponse.json({ message });
}

/**
 * POST /api/archive
 * Archives all current (non-archived) confirmed snapshots and their associated data.
 * Accepts optional JSON body: { label?: string }
 *
 * GET /api/archive
 * Returns all archive batches (grouped by archivedAt date) with summary info.
 */

import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const user = await prisma.user.findFirst();
    if (!user) return NextResponse.json({ error: "No user" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const label: string | null = body?.label?.trim() || null;

    // Find all active (non-archived) confirmed snapshots
    const activeSnapshots = await prisma.portfolioSnapshot.findMany({
      where: {
        userId: user.id,
        confirmed: true,
        archivedAt: null,
      },
      select: { id: true },
    });

    if (activeSnapshots.length === 0) {
      return NextResponse.json({ ok: false, error: "No active snapshots to archive." }, { status: 400 });
    }

    const archivedAt = new Date();

    await prisma.portfolioSnapshot.updateMany({
      where: { id: { in: activeSnapshots.map(s => s.id) } },
      data: { archivedAt, archiveLabel: label },
    });

    return NextResponse.json({
      ok: true,
      archived: activeSnapshots.length,
      archivedAt: archivedAt.toISOString(),
      label,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const user = await prisma.user.findFirst();
    if (!user) return NextResponse.json({ error: "No user" }, { status: 404 });

    // All archived snapshots with their holdings and reports
    const snapshots = await (prisma as any).portfolioSnapshot.findMany({
      where: {
        userId: user.id,
        archivedAt: { not: null },
      },
      orderBy: { archivedAt: "desc" },
      include: {
        holdings: {
          where: { isCash: false },
          orderBy: { currentValue: "desc" },
          take: 20,
        },
        reports: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            recommendations: {
              orderBy: { currentWeight: "desc" },
              take: 5,
            },
          },
        },
      },
    });

    // Group by archive batch (archivedAt ISO date + label)
    const batches: Record<string, any> = {};
    for (const snap of snapshots) {
      const batchKey = snap.archivedAt!.toISOString();
      if (!batches[batchKey]) {
        batches[batchKey] = {
          archivedAt: snap.archivedAt,
          label: (snap as any).archiveLabel || null,
          snapshotCount: 0,
          snapshots: [],
        };
      }
      batches[batchKey].snapshotCount++;
      batches[batchKey].snapshots.push(snap);
    }

    return NextResponse.json({ batches: Object.values(batches) });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}

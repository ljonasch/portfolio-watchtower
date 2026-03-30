import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { UploadClient } from "./UploadClient";

import Link from "next/link";

export default async function UploadPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  const isUpdate = mode === "update";

  const profile = await prisma.userProfile.findFirst();

  // Detect if the profile is still the bare seed (nothing meaningful filled in)
  const isProfileBlank =
    !profile ||
    (!profile.employmentStatus &&
      !profile.annualIncomeRange &&
      !profile.trackedAccountStyle &&
      !profile.notes &&
      !profile.separateRetirementAssetsAmount);

  return (
    <div className="max-w-2xl mx-auto space-y-8">


      {/* Profile nudge — non-blocking but prominent */}
      {isProfileBlank && !isUpdate && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3">
          <span className="text-amber-400 text-lg mt-0.5">⚠</span>
          <div>
            <p className="text-sm font-semibold text-amber-300">Your profile isn't set up yet</p>
            <p className="text-xs text-amber-500/80 mt-1">
              The AI will give much better advice when it knows your income, risk tolerance, tax status, and goals.
            </p>
            <Link
              href="/settings"
              className="inline-block mt-2 text-xs font-semibold text-amber-400 underline underline-offset-2 hover:text-amber-300"
            >
              → Set up your profile first (Step 1)
            </Link>
          </div>
        </div>
      )}

      <div>
        <h1 className="text-3xl font-bold">
          {isUpdate ? "Step 5 · Update Screenshot" : "Step 2 · Upload Portfolio"}
        </h1>
        <p className="text-slate-400 mt-2">
          {isUpdate
            ? "Upload an updated screenshot of your holdings after making changes, to keep your records current."
            : "Upload or paste a screenshot of your current holdings. The AI will extract every position automatically."}
        </p>
      </div>

      <UploadClient isUpdate={isUpdate} />
    </div>
  );
}

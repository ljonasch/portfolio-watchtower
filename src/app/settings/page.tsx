import { prisma } from "@/lib/prisma";
import { SettingsForm } from "./SettingsForm";
import { NotificationsForm } from "./NotificationsForm";
import { ClearHoldingsButton } from "./ClearHoldingsButton";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await prisma.user.findFirst({
    include: { profile: true, notificationRecipients: true }
  });

  if (!user || !user.profile) {
    return <div>No active user found. Please run seed.</div>;
  }

  const settingsObj = await prisma.appSettings.findFirst({ where: { key: "portfolio_config" } });
  const notifSettingsObj = await prisma.appSettings.findFirst({ where: { key: "notification_settings" } });

  const appSettings = settingsObj ? JSON.parse(settingsObj.value) : {};
  const notifSettings = notifSettingsObj ? JSON.parse(notifSettingsObj.value) : {
    dailyChecksEnabled: true,
    emailNotificationsEnabled: true,
    browserNotificationsEnabled: false,
    weeklySummaryDay: 0,
    weeklySummaryHour: 8,
    dailyCheckHour: 8,
    alertThreshold: "low",
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Step 1 · Profile &amp; Settings</h1>
        <p className="text-slate-400 mt-2 text-sm">
          Configure your personal context, account goals, and notification preferences.
          All fields are optional and can be updated any time.
        </p>
      </div>

      <SettingsForm profile={user.profile} appSettings={appSettings} />

      <NotificationsForm
        recipients={user.notificationRecipients}
        notifSettings={notifSettings}
      />

      <ClearHoldingsButton />
    </div>
  );
}

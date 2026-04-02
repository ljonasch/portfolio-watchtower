import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import 'dotenv/config'

const adapter = new PrismaLibSql({
  url: process.env.DATABASE_URL || "file:./dev.db"
})
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('Seeding MVP mock data...')
  
  // Create default user
  const user = await prisma.user.create({
    data: {
      email: 'lucasjonasch98@gmail.com',
      name: 'Lucas Jonasch',
      profile: {
        create: {
          birthYear: 1998,
          targetRetirementAge: 65,
          trackedAccountObjective: 'growth',
          trackedAccountRiskTolerance: 'high',
        }
      },
      notificationRecipients: {
        create: {
          email: 'lucasjonasch98@gmail.com',
          label: 'Primary',
          active: true,
        }
      }
    }
  })

  // Default app settings
  await prisma.appSettings.upsert({
    where: { key: 'portfolio_config' },
    create: { key: 'portfolio_config', value: JSON.stringify({}) },
    update: {}
  })

  // Default notification settings
  await prisma.appSettings.upsert({
    where: { key: 'notification_settings' },
    create: {
      key: 'notification_settings',
      value: JSON.stringify({
        dailyChecksEnabled: true,
        emailNotificationsEnabled: true,
        browserNotificationsEnabled: false,
        weeklySummaryDay: 0, // Sunday
        weeklySummaryHour: 8,
        dailyCheckHour: 8,
        alertThreshold: 'low', // send email whenever alertLevel >= 'low'
      })
    },
    update: {}
  })

  // Batch 6: validation_enforce_block — when true, hard validation errors abort the run
  // Default is "false" (log-only). Set to "true" to enable hard enforcement.
  await prisma.appSettings.upsert({
    where: { key: 'validation_enforce_block' },
    create: { key: 'validation_enforce_block', value: 'false' },
    update: {}
  })

  // Batch 9 / T47: antichurn_threshold_pct — weight change below this % → override Trim/Buy to Hold
  // Default is 1.5%. Adjustable without code change via AppSettings.
  await prisma.appSettings.upsert({
    where: { key: 'antichurn_threshold_pct' },
    create: { key: 'antichurn_threshold_pct', value: '1.5' },
    update: {}
  })

  console.log(`Seeded user: ${user.email}, notification recipient: lucasjonasch98@gmail.com`)
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })

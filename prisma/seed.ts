import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.messageTemplate.upsert({
    where: { key: "lead_ack_email" },
    update: {},
    create: {
      key: "lead_ack_email",
      channel: "EMAIL",
      name: "Lead Acknowledgement Email",
      subject: "Thanks for your interest in {{brand}}, {{name}}!",
      body: [
        "Hi {{name}},",
        "",
        "Thanks for reaching out to {{brand}} about {{course}}. Our team has received your details",
        "and one of our counsellors will get in touch with you shortly.",
        "",
        "In the meantime, feel free to reply to this email with any questions.",
        "",
        "— Team {{brand}}",
      ].join("\n"),
    },
  });

  await prisma.messageTemplate.upsert({
    where: { key: "lead_ack_whatsapp" },
    update: {},
    create: {
      key: "lead_ack_whatsapp",
      channel: "WHATSAPP",
      name: "Lead Acknowledgement WhatsApp",
      body: [
        "Hi {{name}}! 👋 Thanks for your interest in {{brand}} — {{course}}.",
        "Our team will reach out shortly. Reply here anytime with questions!",
      ].join("\n"),
    },
  });

  console.log("Seed complete: default message templates created.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

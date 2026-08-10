import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const sesClient = new SESClient({ region: process.env.AWS_REGION ?? "ap-south-1" });

export async function sendAcknowledgementEmail(opts: {
  to: string;
  subject: string;
  bodyText: string;
}) {
  const fromAddress = process.env.SES_FROM_EMAIL;
  if (!fromAddress) {
    throw new Error("SES_FROM_EMAIL is not configured");
  }

  const command = new SendEmailCommand({
    Source: fromAddress,
    Destination: { ToAddresses: [opts.to] },
    Message: {
      Subject: { Data: opts.subject, Charset: "UTF-8" },
      Body: {
        Text: { Data: opts.bodyText, Charset: "UTF-8" },
      },
    },
  });

  const result = await sesClient.send(command);
  return result.MessageId;
}

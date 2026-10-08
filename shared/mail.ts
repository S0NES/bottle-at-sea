/**
 * One-way email for replies. The recipient address is read from the database
 * by the server only; it is never part of any API response.
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export type Mailer = (msg: MailMessage) => Promise<boolean>;

export function composeReplyEmail(reply: string, bottleCreatedAt: number): MailMessage & { to: '' } {
  const when = new Date(bottleCreatedAt).toISOString().slice(0, 10);
  return {
    to: '',
    subject: 'A stranger answered your bottle',
    text: [
      `A stranger found the bottle you threw into the sea on ${when} and wrote back:`,
      '',
      reply
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n'),
      '',
      '—',
      'This is a one-way message. You can’t reply to it, and they will never see your address.',
      'You are receiving it only because you added an email when you sealed that bottle.',
    ].join('\n'),
  };
}

export function resendMailer(apiKey: string, from: string): Mailer {
  return async (msg) => {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };
}

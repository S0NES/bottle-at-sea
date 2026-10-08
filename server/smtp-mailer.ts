import nodemailer from 'nodemailer';
import type { Mailer } from '../shared/mail';

export function smtpMailer(url: string, from: string): Mailer {
  const transport = nodemailer.createTransport(url);
  return async (msg) => {
    try {
      await transport.sendMail({ from, to: msg.to, subject: msg.subject, text: msg.text });
      return true;
    } catch (e) {
      console.error('smtp error', e instanceof Error ? e.message : 'unknown');
      return false;
    }
  };
}

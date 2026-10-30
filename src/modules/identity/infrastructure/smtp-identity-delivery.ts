import nodemailer, { type Transporter } from 'nodemailer';
import type { InvitationDelivery } from '../application/invitations.js';
import type { PasswordResetDelivery } from '../application/password-reset.js';

export interface IdentityMailTransport {
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
}

/** Plain-text mail only; URLs and tokens are never logged by this adapter. */
export class SmtpIdentityDelivery implements InvitationDelivery, PasswordResetDelivery {
  private constructor(private readonly transport: IdentityMailTransport, private readonly from: string) {}

  static connect(smtpUrl: string, from: string): SmtpIdentityDelivery {
    const transport = nodemailer.createTransport(smtpUrl) as Transporter;
    return new SmtpIdentityDelivery(transport, from);
  }

  async send(input: { email: string; invitationUrl: string; expiresAt: Date }): Promise<void>;
  async send(input: { email: string; resetUrl: string; expiresAt: Date }): Promise<void>;
  async send(input: { email: string; invitationUrl?: string; resetUrl?: string; expiresAt: Date }): Promise<void> {
    const invitation = Boolean(input.invitationUrl);
    const url = input.invitationUrl ?? input.resetUrl;
    if (!url) throw new Error('Identity message URL is required.');
    const subject = invitation ? 'You are invited to FlowForge' : 'Reset your FlowForge password';
    const action = invitation ? 'accept this organization invitation' : 'reset your password';
    await this.transport.sendMail({
      from: this.from,
      to: input.email,
      subject,
      text: `Use this link to ${action}:\n${url}\n\nThis link expires at ${input.expiresAt.toISOString()}. If you did not request this, you can ignore this message.`,
    });
  }
}

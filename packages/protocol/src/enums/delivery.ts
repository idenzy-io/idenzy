/** Outbound message channels. Each is metered and spend-capped separately (PROJECT.md 5.1). */
export const Channel = {
  Email: "email",
  Sms: "sms",
  Whatsapp: "whatsapp",
} as const;
export type Channel = (typeof Channel)[keyof typeof Channel];

/** Transactional template types shipped with every project. */
export const TemplateType = {
  EmailVerification: "email_verification",
  MagicLink: "magic_link",
  EmailOtp: "email_otp",
  SmsOtp: "sms_otp",
  PasswordReset: "password_reset",
  EmailChangeOld: "email_change_old",
  EmailChangeNew: "email_change_new",
  Invite: "invite",
  NewDeviceSignin: "new_device_signin",
  MfaEnrolled: "mfa_enrolled",
  PasswordChanged: "password_changed",
} as const;
export type TemplateType = (typeof TemplateType)[keyof typeof TemplateType];

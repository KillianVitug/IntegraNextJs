declare module "nodemailer" {
  export type SendMailOptions = {
    from: string;
    replyTo?: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  };

  export type Transporter = {
    verify(): Promise<unknown>;
    sendMail(options: SendMailOptions): Promise<unknown>;
  };

  export type TransportOptions = {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
  };

  const nodemailer: {
    createTransport(options: TransportOptions): Transporter;
  };

  export default nodemailer;
}

import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API route for sending invitations via Gmail
  app.post("/api/send-invite", async (req, res) => {
    const { inviteEmail, inviterName, tripName, inviteLink } = req.body;

    if (!inviteEmail || !inviterName || !tripName || !inviteLink) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const gmailUser = process.env.GMAIL_USER || "tripspend4@gmail.com";
    const gmailPass = process.env.GMAIL_APP_PASSWORD;

    if (!gmailPass) {
      console.warn("GMAIL_APP_PASSWORD is not set.");
      return res.status(500).json({ 
        error: "E-mailová služba není nakonfigurována. Prosím nastavte GMAIL_APP_PASSWORD v Secrets." 
      });
    }

    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: gmailUser,
          pass: gmailPass,
        },
      });

      console.log(`Sending Gmail invite to ${inviteEmail} for trip ${tripName}`);

      const mailOptions = {
        from: `"TripSpend" <${gmailUser}>`,
        to: inviteEmail,
        subject: `Pozvánka na výlet: ${tripName}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <h2 style="color: #5A5A40;">Ahoj!</h2>
            <p style="font-size: 16px; line-height: 1.5; color: #333;">
              <strong>${inviterName}</strong> ti sdílí svůj výlet <strong>${tripName}</strong> v aplikaci TripSpend.
            </p>
            <p style="font-size: 16px; line-height: 1.5; color: #333;">
              Klikni na tlačítko níže pro přijetí pozvánky a začněte plánovat společně!
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${inviteLink}" style="background-color: #5A5A40; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                Přijmout pozvánku
              </a>
            </div>
            <p style="font-size: 14px; color: #666; border-top: 1px solid #eee; pt: 20px; margin-top: 20px;">
              Pokud tlačítko nefunguje, zkopíruj tento odkaz do prohlížeče:<br>
              <span style="color: #5A5A40; word-break: break-all;">${inviteLink}</span>
            </p>
            <p style="font-size: 12px; color: #999; margin-top: 30px; text-align: center;">
              Tento e-mail byl odeslán automaticky z aplikace TripSpend přes váš Gmail.
            </p>
          </div>
        `,
      };

      await transporter.sendMail(mailOptions);
      res.status(200).json({ success: true });
    } catch (error: any) {
      console.error("Gmail sending error:", error);
      res.status(500).json({ error: error.message || "Chyba při odesílání e-mailu přes Gmail." });
    }
  });
  
  // API route for notifying inviter that their invite was accepted
  app.post("/api/send-invite-accepted", async (req, res) => {
    const { inviterEmail, inviterName, inviteeName, tripName } = req.body;

    if (!inviterEmail || !inviterName || !inviteeName || !tripName) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const gmailUser = process.env.GMAIL_USER || "tripspend4@gmail.com";
    const gmailPass = process.env.GMAIL_APP_PASSWORD;

    if (!gmailPass) {
      return res.status(500).json({ error: "E-mailová služba není nakonfigurována." });
    }

    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: gmailUser,
          pass: gmailPass,
        },
      });

      const mailOptions = {
        from: `"TripSpend" <${gmailUser}>`,
        to: inviterEmail,
        subject: `Pozvánka přijata: ${tripName}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <h2 style="color: #5A5A40;">Ahoj ${inviterName}!</h2>
            <p style="font-size: 16px; line-height: 1.5; color: #333;">
              <strong>${inviteeName}</strong> právě přijal tvoji pozvánku! Nyní můžete oba pracovat na výletě <strong>${tripName}</strong>.
            </p>
            <p style="font-size: 16px; line-height: 1.5; color: #333;">
              Přejeme vám příjemné společné plánování!
            </p>
            <p style="font-size: 12px; color: #999; margin-top: 30px; text-align: center; border-top: 1px solid #eee; pt: 20px;">
              Tento e-mail byl odeslán automaticky z aplikace TripSpend.
            </p>
          </div>
        `,
      };

      await transporter.sendMail(mailOptions);
      res.status(200).json({ success: true });
    } catch (error: any) {
      console.error("Gmail sending error:", error);
      res.status(500).json({ error: error.message || "Chyba při odesílání e-mailu." });
    }
  });

  // API Route for sending direct invitations to join the app (Osoby / People section)
  app.post("/api/send-person-invite", async (req, res) => {
    const { email, inviterName, webLink } = req.body;

    if (!email || !inviterName || !webLink) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const gmailUser = process.env.GMAIL_USER || "tripspend4@gmail.com";
    const gmailPass = process.env.GMAIL_APP_PASSWORD;

    if (!gmailPass) {
      return res.status(500).json({ error: "E-mailová služba není nakonfigurována." });
    }

    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: gmailUser,
          pass: gmailPass,
        },
      });

      console.log(`Sending Gmail person invite to ${email} from ${inviterName}`);

      const mailOptions = {
        from: `"TripSpend" <${gmailUser}>`,
        to: email,
        subject: `${inviterName} tě zve do aplikace TripSpend`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 25px; border: 1px solid #e2e8f0; border-radius: 20px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
            <div style="text-align: center; margin-bottom: 25px;">
              <h1 style="color: #5A5A40; margin: 0; font-family: Georgia, serif; font-size: 28px;">TripSpend</h1>
              <p style="color: #64748b; font-size: 14px; margin: 5px 0 0 0; text-transform: uppercase; letter-spacing: 0.1em; font-weight: bold;">Zápisník útrat na dovolenou</p>
            </div>
            
            <p style="font-size: 16px; line-height: 1.6; color: #1e293b; margin-top: 0;">
              Ahoj,
            </p>
            <p style="font-size: 16px; line-height: 1.6; color: #1e293b;">
              <strong>${inviterName}</strong> tě zve do skvělé aplikace <strong>TripSpend</strong> na zapisování útrat při dovolených.
            </p>
            <p style="font-size: 16px; line-height: 1.6; color: #1e293b;">
              Už žádné složité rozpočítávání a dohadování, kdo co platil. Mějte všechny výlohy na cestách přehledně pod kontrolou!
            </p>
            
            <div style="text-align: center; margin: 35px 0; gap: 15px;">
              <a href="https://apps.apple.com/cz/app/tripspend/id6766637889" style="background-color: #5A5A40; color: white; padding: 14px 28px; text-decoration: none; border-radius: 14px; font-weight: bold; display: inline-block; margin: 10px; font-size: 14px; box-shadow: 0 4px 6px -1px rgba(90,90,64,0.2);">
                Stáhnout z App Store
              </a>
              <a href="${webLink}" style="background-color: #f1f5f9; color: #334155; padding: 14px 28px; text-decoration: none; border-radius: 14px; font-weight: bold; display: inline-block; margin: 10px; font-size: 14px; border: 1px solid #cbd5e1;">
                Přejít na Web
              </a>
            </div>
            
            <div style="border-top: 1px solid #e2e8f0; padding-top: 20px; margin-top: 30px; text-align: center;">
              <p style="font-size: 12px; color: #64748b; margin: 0;">
                Tento e-mail byl odeslán automaticky z aplikace TripSpend.
              </p>
            </div>
          </div>
        `,
      };

      await transporter.sendMail(mailOptions);
      res.status(200).json({ success: true });
    } catch (error: any) {
      console.error("Gmail sending error:", error);
      res.status(500).json({ error: error.message || "Chyba při odesílání e-mailu." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

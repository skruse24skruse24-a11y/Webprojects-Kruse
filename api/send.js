const nodemailer = require("nodemailer");

const ALLOWED_ORIGIN = "https://webproject.samkrusedesign.com";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email, imageBase64, glyph } = req.body ?? {};

  // Basic server-side validation
  if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Invalid email address" });
  }
  if (!imageBase64 || typeof imageBase64 !== "string" || !imageBase64.startsWith("data:image/png;base64,")) {
    return res.status(400).json({ error: "Invalid image data" });
  }
  if (imageBase64.length > 5_000_000) {
    return res.status(413).json({ error: "Image too large" });
  }

  const safeGlyph = typeof glyph === "string" ? glyph.slice(0, 4).replace(/[^A-Za-z0-9]/g, "") : "char";
  const base64Data = imageBase64.replace(/^data:image\/png;base64,/, "");

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  try {
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: email,
      subject: `Your Character: ${safeGlyph}`,
      html: `
        <p>This is your very own character!</p>
        <img src="cid:character-png" alt="Your character" style="max-width:600px; display:block; margin-top:16px; margin-bottom:16px;">
        <p>Enjoy,</p>
        <p>Sam Kruse<br><a href="https://webproject.samkrusedesign.com">SamKruseDesign.com</a></p>
      `,
      attachments: [
        {
          filename: `character-${safeGlyph}.png`,
          content: base64Data,
          encoding: "base64",
          cid: "character-png",
        },
      ],
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("Mail send error:", err);
    res.status(500).json({ error: "Mail send failed" });
  }
};

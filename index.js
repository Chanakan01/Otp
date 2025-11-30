// ================== IMPORT ==================
import express from "express";
import line from "@line/bot-sdk";
import axios from "axios";

// ================== CONFIG ==================
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

// ================== CONFIG SMS-ACTIVATE ==================
const SMS_API = "https://api.sms-activate.org/stubs/handler_api.php";
const API_KEY = process.env.SMS_ACTIVATE_API_KEY;

// map ชื่อบริการ -> service code บน SMS-Activate
const serviceMap = {
  google: "go",
  netflix: "nf",
};

// ================== LINE CLIENT ==================
const client = new line.Client(config);
const app = express();

// =========== WEBHOOK ==============
app.post("/webhook", line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch((err) => {
      console.error("Webhook Error:", err);
      res.status(500).end();
    });
});

// ================== MAIN EVENT ==================
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;

  const text = event.message.text.toLowerCase();

  // ============= เมนูหลัก =============
  if (text === "เมนู") {
    return client.replyMessage(event.replyToken, menuFlex());
  }

  // ============= ซื้อเบอร์ Google =============
  if (text === "otp_google") {
    return buyNumber(event.replyToken, "google");
  }

  // ============= ซื้อเบอร์ Netflix =============
  if (text === "otp_netflix") {
    return buyNumber(event.replyToken, "netflix");
  }
}

// ================== ซื้อเบอร์ ==================
async function buyNumber(replyToken, serviceName) {
  try {
    const serviceCode = serviceMap[serviceName];

    // 1) ขอเบอร์ใหม่
    const url = `${SMS_API}?api_key=${API_KEY}&action=getNumber&service=${serviceCode}&country=66`;
    const res = await axios.get(url);

    // รูปแบบ response เช่น: OK:1234567:66876543210
    if (!res.data.startsWith("OK")) {
      return client.replyMessage(replyToken, {
        type: "text",
        text: "⚠ ไม่สามารถขอเบอร์ได้ กรุณาลองใหม่อีกครั้ง",
      });
    }

    const parts = res.data.split(":");
    const activationId = parts[1];
    const phoneNumber = parts[2];

    // ส่งเบอร์ให้ผู้ใช้
    await client.replyMessage(replyToken, {
      type: "text",
      text: `📱 เบอร์ของคุณคือ: ${phoneNumber}\n⏳ กำลังรอ OTP...`,
    });

    // 2) รอ OTP
    const otp = await waitForOTP(activationId);

    // 3) ส่ง OTP ให้ผู้ใช้
    return client.pushMessage(replyToken, {
      type: "text",
      text: `🔐 OTP ของคุณคือ: ${otp}`,
    });
  } catch (err) {
    console.error("Buy Error:", err);
    return client.replyMessage(replyToken, {
      type: "text",
      text: "⚠ ระบบมีปัญหา กรุณาลองใหม่อีกครั้ง",
    });
  }
}

// ================== รอ OTP ==================
async function waitForOTP(id) {
  return new Promise((resolve, reject) => {
    let count = 0;

    const timer = setInterval(async () => {
      count++;

      const url = `${SMS_API}?api_key=${API_KEY}&action=getStatus&id=${id}`;
      const res = await axios.get(url);

      if (res.data.startsWith("STATUS_OK")) {
        clearInterval(timer);
        const otp = res.data.replace("STATUS_OK:", "").trim();
        resolve(otp);
      }

      if (count > 30) {
        clearInterval(timer);
        reject("timeout");
      }
    }, 4000);
  });
}

// ================== เมนู FLEX ==================
function menuFlex() {
  return {
    type: "flex",
    altText: "เมนูบริการ",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "เลือกแอพ",
            weight: "bold",
            size: "xl",
          },
          {
            type: "text",
            text: "เลือกบริการที่ต้องการใช้เบอร์ OTP",
            size: "sm",
            margin: "md",
          },
          {
            type: "box",
            layout: "vertical",
            spacing: "md",
            margin: "lg",
            contents: [
              makeButton("Google", "otp_google"),
              makeButton("Netflix", "otp_netflix"),
            ],
          },
        ],
      },
    },
  };
}

// ปุ่มใน Flex
function makeButton(label, text) {
  return {
    type: "button",
    action: {
      type: "message",
      label,
      text,
    },
    style: "primary",
    color: "#1E88E5",
  };
}

// ================== SERVER ==================
app.listen(10000, () => console.log("Bot running on port 10000"));

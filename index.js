// ================== IMPORT ==================
import express from "express";
import line from "@line/bot-sdk";
import SMSActivate from "sms-activate";

// ================== CONFIG ==================
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const sms = new SMSActivate(process.env.SMS_ACTIVATE_API_KEY);

// map ชื่อบริการในเมนู → service code ของ SMS-Activate
const serviceMap = {
  google: "go",
  netflix: "nf",
};

const client = new line.Client(config);
const app = express();

app.post(
  "/webhook",
  line.middleware(config),
  (req, res) => {
    Promise.all(req.body.events.map(handleEvent))
      .then(() => res.status(200).end())
      .catch((err) => {
        console.error("Error in webhook:", err);
        res.status(500).end();
      });
  }
);

// ================== MAIN FUNCTION ==================
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return;
  }

  const text = event.message.text.toLowerCase();
  const userId = event.source.userId;

  // =========== แสดงเมนูหลัก ===========
  if (text === "เมนู") {
    const flex = {
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
              size: "xl"
            },
            {
              type: "text",
              text: "เลือกบริการที่ต้องการใช้เบอร์ OTP",
              size: "sm",
              margin: "md"
            },
            {
              type: "box",
              layout: "vertical",
              spacing: "md",
              margin: "lg",
              contents: [
                makeButton("Google", "otp_google"),
                makeButton("Netflix", "otp_netflix")
              ]
            }
          ]
        }
      }
    };

    return client.replyMessage(event.replyToken, flex);
  }

  // =========== ซื้อเบอร์ Google ===========
  if (text === "otp_google") {
    return buyNumber(event.replyToken, "google");
  }

  // =========== ซื้อเบอร์ Netflix ===========
  if (text === "otp_netflix") {
    return buyNumber(event.replyToken, "netflix");
  }
}

// ================== FUNCTION ซื้อเบอร์ ==================
async function buyNumber(replyToken, serviceName) {
  try {
    const serviceCode = serviceMap[serviceName];

    // 1) ขอเบอร์จาก SMS-Activate
    const numberData = await sms.getNumber({
      service: serviceCode,
      country: 66 // ไทย
    });

    if (!numberData || !numberData.phone) {
      return client.replyMessage(replyToken, {
        type: "text",
        text: "⚠ ระบบไม่สามารถขอเบอร์ได้ กรุณาลองใหม่อีกครั้งครับ/ค่ะ"
      });
    }

    const id = numberData.id;
    const phone = numberData.phone;

    // แจ้งเบอร์ให้ผู้ใช้ก่อน
    await client.replyMessage(replyToken, {
      type: "text",
      text: `เบอร์ของคุณคือ: ${phone}\nกำลังรอ OTP...`
    });

    // 2) รอ OTP
    const otp = await waitForOTP(id);

    // ส่ง OTP ให้ผู้ใช้
    return client.pushMessage(
      numberData.userId,
      {
        type: "text",
        text: `OTP ของคุณคือ: ${otp}`
      }
    );

  } catch (err) {
    console.error("Buy error:", err);
    return client.replyMessage(replyToken, {
      type: "text",
      text: "⚠ ระบบมีปัญหาชั่วคราว กรุณาลองใหม่อีกครั้งครับ/ค่ะ"
    });
  }
}

// ================== FUNCTION รอ OTP ==================
async function waitForOTP(id) {
  return new Promise((resolve, reject) => {
    let tries = 0;

    const interval = setInterval(async () => {
      tries++;

      const status = await sms.getStatus(id);

      if (status && status.code === "STATUS_OK") {
        clearInterval(interval);
        resolve(status.sms);
      }

      if (tries > 30) {
        clearInterval(interval);
        reject("timeout");
      }
    }, 4000);
  });
}

// ============ สร้างปุ่มใน Flex ==============
function makeButton(label, data) {
  return {
    type: "button",
    action: {
      type: "message",
      label,
      text: data
    },
    style: "primary",
    color: "#1E88E5"
  };
}

// ============ RUN SERVER ==============
app.listen(10000, () => console.log("Bot running on port 10000"));

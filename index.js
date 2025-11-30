const express = require("express");
const line = require("@line/bot-sdk");
const { SMSActivate } = require("sms-activate");

// ============= CONFIG จาก ENV =============
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const SMS_ACTIVATE_API_KEY = process.env.SMS_ACTIVATE_API_KEY;

// สร้าง instance ของ SMS-Activate
const smsApi = new SMSActivate(SMS_ACTIVATE_API_KEY);

// map บริการที่เราจะใช้ -> service code ของ SMS-Activate
// service code ตัวอย่าง: 'go' = Google, 'nf' = Netflix (สมมติ)
// ให้ไปเช็คใน docs ของ SMS-Activate อีกทีว่า code จริงคืออะไร
const serviceMap = {
  google: "go",
  netflix: "nf",
};

// ============= สร้าง LINE client & Express app =============
const client = new line.Client(config);
const app = express();

// ============= Webhook route สำหรับ LINE =============
app.post("/webhook", line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// ============= handleEvent =============
async function handleEvent(event) {
  if (event.type === "message" && event.message.type === "text") {
    const text = event.message.text.trim();

    if (text === "เมนู" || text === "เริ่ม" || text.toLowerCase() === "menu") {
      return replyAppMenu(event.replyToken);
    } else {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: 'พิมพ์ "เมนู" เพื่อเลือกบริการที่ต้องการเบอร์ OTP (เช่น Google / Netflix)',
      });
    }
  }

  if (event.type === "postback") {
    const data = event.postback.data; // เช่น "svc=google"
    const params = new URLSearchParams(data);
    const svc = params.get("svc"); // google / netflix
    const userId = event.source.userId;

    return handleBuyOtpWithSMSActivate(event.replyToken, userId, svc);
  }

  return Promise.resolve(null);
}

// ============= Flex Message เมนูเลือกบริการ =============
function replyAppMenu(replyToken) {
  const message = {
    type: "flex",
    altText: "เลือกบริการที่ต้องการเบอร์ OTP",
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "เลือกบริการที่ต้องการเบอร์ OTP",
            weight: "bold",
            size: "lg",
            align: "center",
          },
          {
            type: "box",
            layout: "horizontal",
            margin: "lg",
            spacing: "md",
            contents: [
              // ปุ่ม Google
              {
                type: "box",
                layout: "vertical",
                flex: 1,
                alignItems: "center",
                action: {
                  type: "postback",
                  label: "Google",
                  data: "svc=google",
                },
                contents: [
                  {
                    type: "image",
                    url: "https://i.imgur.com/xIY5sVZ.png",
                    size: "xl",
                    aspectRatio: "1:1",
                  },
                  {
                    type: "text",
                    text: "Google",
                    size: "sm",
                    align: "center",
                    margin: "sm",
                  },
                ],
              },
              // ปุ่ม Netflix
              {
                type: "box",
                layout: "vertical",
                flex: 1,
                alignItems: "center",
                action: {
                  type: "postback",
                  label: "Netflix",
                  data: "svc=netflix",
                },
                contents: [
                  {
                    type: "image",
                    url: "https://i.imgur.com/0e5gZUX.png",
                    size: "xl",
                    aspectRatio: "1:1",
                  },
                  {
                    type: "text",
                    text: "Netflix",
                    size: "sm",
                    align: "center",
                    margin: "sm",
                  },
                ],
              },
            ],
          },
          {
            type: "text",
            text: 'พิมพ์ "เมนู" เพื่อเปิดหน้านี้อีกครั้ง',
            size: "xs",
            color: "#888888",
            align: "center",
            margin: "lg",
          },
        ],
      },
    },
  };

  return client.replyMessage(replyToken, message);
}

// ============= ฟังก์ชันซื้อเบอร์ + รับ OTP จาก SMS-Activate =============
async function handleBuyOtpWithSMSActivate(replyToken, userId, svcKey) {
  try {
    const serviceCode = serviceMap[svcKey];

    if (!serviceCode) {
      return client.replyMessage(replyToken, {
        type: "text",
        text: `ยังไม่ได้ตั้งค่าบริการสำหรับ '${svcKey}'`,
      });
    }

    // 0 = auto country (ดูจาก docs ว่าจะใช้ country ไหน เช่น 0 หรือ code ประเทศ)
    const country = 0;

    // ขอเบอร์จาก SMS-Activate
    const number = await smsApi.getNumber({
      service: serviceCode,
      country: country,
    });

    const phoneNumber = number.phoneNumber;
    console.log(`Got number for ${svcKey}:`, phoneNumber);

    // ตอบเบอร์ให้ user ก่อน
    await client.replyMessage(replyToken, {
      type: "text",
      text:
        `📱 เบอร์สำหรับ ${svcKey.toUpperCase()} ของคุณคือ:\n` +
        `${phoneNumber}\n\nกำลังรอ OTP...`,
    });

    // รอ OTP (ถ้าไม่มีมาในเวลาที่ lib กำหนดจะ throw error)
    const code = await number.getCode();
    console.log("Received OTP:", code);

    // บอก SMS-Activate ว่าใช้เสร็จแล้ว success
    await number.success();

    // ส่ง OTP ให้ user (push ไปยัง user)
    await client.pushMessage(userId, {
      type: "text",
      text:
        `✅ ได้รับ OTP แล้ว\n\n` +
        `บริการ: ${svcKey.toUpperCase()}\n` +
        `เบอร์: ${phoneNumber}\n` +
        `OTP: ${code}`,
    });
  } catch (err) {
    console.error("Error in SMS-Activate:", err);

    return client.replyMessage(replyToken, {
      type: "text",
      text: "❌ ขอเบอร์/OTP ไม่สำเร็จ ลองใหม่อีกครั้งนะครับ/ค่ะ",
    });
  }
}

// ============= Start server =============
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

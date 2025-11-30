const express = require("express");
const line = require("@line/bot-sdk");
const axios = require("axios");

// ================= CONFIG จาก ENV =================
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const PHONE_API_KEY = process.env.PHONE_API_KEY;          // keyapi จาก otp24hr
const PHONE_API_URL = process.env.PHONE_API_URL;          // เช่น https://otp24hr.com/api/v1

// map ชื่อแอพ (ฝั่ง LINE) -> type_code ของ otp24hr
// ❗ ไปดูที่เอกสาร getpack ว่ารหัส type_code ของแอพแต่ละตัวคืออะไร แล้วแก้เลขตรงนี้
const productMap = {
  facebook: 127,   // ตัวอย่าง: type_code ของ Facebook
  tiktok: 140,     // แก้ตามจริง
  line: 145,       // แก้ตามจริง
  telegram: 150    // แก้ตามจริง
};

// ================= สร้าง LINE client & Express app =================
const client = new line.Client(config);
const app = express();

// ================= ROUTE สำหรับ LINE Webhook =================
app.post("/webhook", line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// ================= HANDLE EVENT หลัก =================
async function handleEvent(event) {
  // ข้อความธรรมดา
  if (event.type === "message" && event.message.type === "text") {
    const text = event.message.text.trim();

    if (text === "เมนู" || text === "เริ่ม" || text === "ซื้อเบอร์") {
      return replyAppMenu(event.replyToken);
    } else {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: 'พิมพ์คำว่า "เมนู" หรือ "ซื้อเบอร์" เพื่อเลือกแอพที่ต้องการใช้เบอร์ 😊',
      });
    }
  }

  // กดปุ่ม postback จากเมนู
  if (event.type === "postback") {
    const data = event.postback.data;        // เช่น "app=facebook"
    const params = new URLSearchParams(data);
    const appName = params.get("app");       // facebook / line / tiktok / telegram
    const replyToken = event.replyToken;
    const userId = event.source.userId;

    return handleBuyNumber(replyToken, appName, userId);
  }

  return Promise.resolve(null);
}

// ================= เมนูเลือกแอพ =================
function replyAppMenu(replyToken) {
  const message = {
    type: "template",
    altText: "เลือกแอพที่ต้องการใช้เบอร์",
    template: {
      type: "buttons",
      text: "เลือกแอพที่ต้องการใช้เบอร์",
      actions: [
        {
          type: "postback",
          label: "Facebook",
          data: "app=facebook",
        },
        {
          type: "postback",
          label: "LINE",
          data: "app=line",
        },
        {
          type: "postback",
          label: "Telegram",
          data: "app=telegram",
        },
        {
          type: "postback",
          label: "Tiktok",
          data: "app=tiktok",
        },
      ],
    },
  };

  return client.replyMessage(replyToken, message);
}

// ================= เรียก API otp24hr เพื่อซื้อเบอร์ (buyotp) =================
async function handleBuyNumber(replyToken, appName, userId) {
  try {
    const typeCode = productMap[appName];

    if (!typeCode) {
      return client.replyMessage(replyToken, {
        type: "text",
        text: `ยังไม่ได้ตั้งรหัสสินค้า (type_code) สำหรับแอพ '${appName}' เลยครับ/ค่ะ`,
      });
    }

    // ส่งแบบ urlencoded (ใช้ง่าย และเซิร์ฟเวอร์ส่วนใหญ่รับเหมือน form-data)
    const body = new URLSearchParams();
    body.append("keyapi", PHONE_API_KEY);
    body.append("type", String(typeCode));
    body.append("ct", "52"); // 52 = Thailand ตาม docs

    const url = `${PHONE_API_URL}?action=buyotp`;

    const response = await axios.post(url, body);
    const data = response.data;

    console.log("buyotp response:", data);

    if (data.status !== "success") {
      return client.replyMessage(replyToken, {
        type: "text",
        text:
          `❌ ซื้อเบอร์ไม่สำเร็จ\n` +
          `แอพ: ${appName}\n` +
          `สาเหตุ: ${data.msg || "ไม่ทราบสาเหตุ"}`
      });
    }

    const msgText =
      `🎉 ซื้อเบอร์สำเร็จแล้ว!\n\n` +
      `📌 แอพ: ${data.app}\n` +
      `📱 เบอร์: ${data.number}\n` +
      `🆔 Order ID: ${data.order_id}\n` +
      `💸 ราคาต้นทุน: ${data.price_ori}\n` +
      `💳 เครดิตคงเหลือ: ${data.credit_tottal}\n\n` +
      `เก็บ Order ID ไว้ใช้เช็ค OTP ต่อได้ (ผ่าน endpoint otp_status)`;

    return client.replyMessage(replyToken, {
      type: "text",
      text: msgText,
    });

  } catch (err) {
    console.error("Error calling buyotp:", err?.response?.data || err.message);

    return client.replyMessage(replyToken, {
      type: "text",
      text: "⚠ ระบบมีปัญหาชั่วคราว ลองใหม่อีกครั้งนะครับ/ค่ะ",
    });
  }
}

// ================= START SERVER (Render จะกำหนด PORT มาให้) =================
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

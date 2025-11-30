const express = require("express");
const line = require("@line/bot-sdk");
const axios = require("axios");

// ====== ตั้งค่า ENV (ไปใส่จริงใน Render) ======
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const PHONE_API_KEY = process.env.PHONE_API_KEY;        // api key ผู้ให้บริการเบอร์
const PHONE_API_BASE_URL = process.env.PHONE_API_URL;   // base url เช่น https://api.xxx.com

// ====== สร้าง LINE client กับ Express app ======
const client = new line.Client(config);
const app = express();

// LINE webhook ต้องอ่าน raw body
app.post("/webhook", line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// ====== ฟังก์ชันจัดการ event หลัก ======
async function handleEvent(event) {
  // ถ้าไม่ใช่ข้อความ แต่เราอยากรองรับแค่ข้อความ/postback ก็เช็คก่อน
  if (event.type === "message" && event.message.type === "text") {
    const text = event.message.text.trim();

    // คำสั่งเริ่มต้น ขอเมนู
    if (text === "เมนู" || text === "เริ่ม" || text === "ซื้อเบอร์") {
      return replyAppMenu(event.replyToken);
    } else {
      // ถ้าพิมพ์อย่างอื่น ก็แนะนำ
      const msg = {
        type: "text",
        text: "พิมพ์คำว่า \"เมนู\" หรือ \"ซื้อเบอร์\" เพื่อเลือกแอพที่ต้องการใช้เบอร์ 😊",
      };
      return client.replyMessage(event.replyToken, msg);
    }
  }

  // ถ้าเป็น postback (เช่นกดปุ่มเลือกแอพ)
  if (event.type === "postback") {
    const data = event.postback.data; // ตัวอย่าง "app=facebook"
    const params = new URLSearchParams(data);
    const appName = params.get("app"); // facebook / line / telegram / tiktok

    // เรียก API ซื้อเบอร์
    const userId = event.source.userId; // ถ้าอยากผูกกับผู้ใช้

    const replyToken = event.replyToken;
    return handleBuyNumber(replyToken, appName, userId);
  }

  return Promise.resolve(null);
}

// ====== ฟังก์ชันส่งเมนูเลือกแอพ ======
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

// ====== ฟังก์ชันยิงไปซื้อเบอร์จาก API ภายนอก ======
async function handleBuyNumber(replyToken, appName, userId) {
  try {
    // ตัวอย่างเรียก API (ต้องไปดู docs ของผู้ให้บริการจริงอีกที)
    const response = await axios.post(`${PHONE_API_BASE_URL}/buy-number`, {
      api_key: PHONE_API_KEY,
      app: appName,
      // ใส่ parameter อื่น ๆ ตาม spec ของ API นั้น เช่น country, operator ฯลฯ
    });

    const data = response.data;

    // สมมติ API ตอบมาแบบ
    // { success: true, phone: "089xxxxxxx", order_id: "123456" }
    if (!data.success) {
      const msg = {
        type: "text",
        text: `ขออภัย ไม่สามารถซื้อเบอร์สำหรับแอพ ${appName} ได้ในตอนนี้ 😢`,
      };
      return client.replyMessage(replyToken, msg);
    }

    const msg = {
      type: "text",
      text:
        `ซื้อเบอร์สำเร็จ ✅\n` +
        `แอพ: ${appName}\n` +
        `เบอร์: ${data.phone}\n` +
        `Order ID: ${data.order_id}\n\n` +
        `เก็บ order id นี้ไว้เพื่อใช้ดึง SMS (ถ้า API รองรับ)`,
    };
    return client.replyMessage(replyToken, msg);
  } catch (err) {
    console.error("Error buying number:", err?.response?.data || err.message);
    const msg = {
      type: "text",
      text: "ระบบมีปัญหาชั่วคราว ลองใหม่อีกครั้งภายหลังนะครับ/ค่ะ 😥",
    };
    return client.replyMessage(replyToken, msg);
  }
}

// ====== start server (Render จะใช้ PORT จาก env) ======
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on ${port}`);
});

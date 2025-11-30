// ================== import ==================
const express = require("express");
const line = require("@line/bot-sdk");
const SMSActivate = require("sms-activate");

// ================== CONFIG LINE ==================
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

// ================== CONFIG SMS-Activate ==================
const sms = new SMSActivate(process.env.SMS_ACTIVATE_API_KEY);

// map ชื่อบริการที่เราจะโชว์ในเมนู -> service code ของ SMS-Activate
// *** สำคัญ: ไปเช็คในเว็บ SMS-Activate ว่า code จริงเป็นอะไร แล้วแก้ให้ตรง ***
// ส่วนใหญ่: Google = "go", Netflix = "nf" (ให้คุณเช็คอีกที)
const serviceMap = {
  google: "go",
  netflix: "nf",
  // ถ้าอยากเพิ่มบริการอื่นก็ค่อยมาเติมทีหลังได้ เช่น
  // line: "me",
  // facebook: "fb",
  // telegram: "tg",
  // tiktok: "tt",
};

// ================== LINE client + Express app ==================
const client = new line.Client(config);
const app = express();

// webhook จาก LINE ต้องยิงมาที่ path นี้
app.post("/webhook", line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch((err) => {
      console.error("Error in webhook:", err);
      res.status(500).end();
    });
});

// ================== handleEvent หลัก ==================
async function handleEvent(event) {
  console.log("EVENT FROM LINE:", JSON.stringify(event, null, 2));

  // ข้อความธรรมดา
  if (event.type === "message" && event.message.type === "text") {
    const text = (event.message.text || "").trim();

    if (text.includes("เมนู") || text.toLowerCase().includes("menu")) {
      return replyMenu(event.replyToken);
    }

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: 'พิมพ์คำว่า "เมนู" เพื่อเลือกบริการที่ต้องการเบอร์ OTP (เช่น Google / Netflix)',
    });
  }

  // กดปุ่ม (postback)
  if (event.type === "postback") {
    const data = event.postback.data; // เช่น "svc=google"
    const params = new URLSearchParams(data);
    const svc = params.get("svc"); // google / netflix

    const replyToken = event.replyToken;
    const userId = event.source.userId;

    return handleBuyOtpWithSMSActivate(replyToken, userId, svc);
  }

  return Promise.resolve(null);
}

// ================== เมนูเลือกแอพ (Template message) ==================
function replyMenu(replyToken) {
  const message = {
    type: "template",
    altText: "เลือกแอพที่ต้องการใช้เบอร์ OTP",
    template: {
      type: "buttons",
      title: "เลือกแอพ",
      text: "เลือกบริการที่ต้องการใช้เบอร์ OTP",
      actions: [
        {
          type: "postback",
          label: "Google",
          data: "svc=google",
        },
        {
          type: "postback",
          label: "Netflix",
          data: "svc=netflix",
        },
        // ถ้าอยากเพิ่มปุ่มอื่น ให้ใส่ต่อได้สูงสุด 4 ปุ่ม
        // {
        //   type: "postback",
        //   label: "Facebook",
        //   data: "svc=facebook",
        // },
        // {
        //   type: "postback",
        //   label: "LINE",
        //   data: "svc=line",
        // },
      ],
    },
  };

  return client.replyMessage(replyToken, message);
}

// ================== ฟังก์ชันหลัก: ซื้อเบอร์ + รอ OTP ==================
async function handleBuyOtpWithSMSActivate(replyToken, userId, svcKey) {
  try {
    if (!svcKey) {
      return client.replyMessage(replyToken, {
        type: "text",
        text: "ไม่พบบริการที่เลือก ลองพิมพ์เมนูใหม่อีกครั้งนะครับ/ค่ะ",
      });
    }

    const serviceCode = serviceMap[svcKey];

    if (!serviceCode) {
      return client.replyMessage(replyToken, {
        type: "text",
        text:
          `ยังไม่ได้ตั้ง service code สำหรับ '${svcKey}'\n` +
          `ให้เข้าไปแก้ในไฟล์ index.js ตรง serviceMap ก่อน`,
      });
    }

    // 1) เช็คยอดคงเหลือก่อน
    const balance = await sms.getBalance();
    console.log("SMS-Activate balance:", balance);

    if (Number(balance) <= 0) {
      return client.replyMessage(replyToken, {
        type: "text",
        text: "ยอดเงินใน SMS-Activate ไม่พอ กรุณาเติมเงินก่อนนะครับ/ค่ะ",
      });
    }

    // 2) ขอเบอร์จาก SMS-Activate
    console.log("Requesting number for service:", serviceCode);
    const { id, number } = await sms.getNumber(serviceCode);
    console.log("Got number:", { id, number });

    // แจ้งสถานะว่าเบอร์พร้อมแล้ว (1 = ready) ตามตัวอย่างใน docs  [oai_citation:1‡Skypack](https://www.skypack.dev/view/sms-activate-api)
    await sms.setStatus(id, 1);

    // ตอบเบอร์ให้ user ก่อน
    await client.replyMessage(replyToken, {
      type: "text",
      text:
        `📱 เบอร์สำหรับ ${svcKey.toUpperCase()} ของคุณคือ:\n` +
        `${number}\n\nโปรดนำเบอร์นี้ไปกรอกในแอพ แล้วรอ OTP...`,
    });

    // 3) เริ่มวนเช็คโค้ด OTP ทุก ๆ N วินาที
    const intervalMs = 5000; // 5 วิ เช็คครั้ง
    const maxTries = 24; // รวม ~2 นาที
    let tries = 0;

    const timer = setInterval(async () => {
      try {
        tries += 1;
        console.log(`Polling code (try ${tries}/${maxTries}) for id=${id}`);
        const code = await sms.getCode(id);

        if (code) {
          clearInterval(timer);
          console.log("Got OTP code:", code);

          // 6 = activation complete  [oai_citation:2‡Skypack](https://www.skypack.dev/view/sms-activate-api)
          await sms.setStatus(id, 6);

          await client.pushMessage(userId, {
            type: "text",
            text:
              `✅ ได้รับ OTP แล้ว\n\n` +
              `บริการ: ${svcKey.toUpperCase()}\n` +
              `เบอร์: ${number}\n` +
              `OTP: ${code}`,
          });
        } else if (tries >= maxTries) {
          clearInterval(timer);
          console.log("Timeout waiting for OTP, cancel activation");

          // 8 = cancel activation  [oai_citation:3‡Skypack](https://www.skypack.dev/view/sms-activate-api?utm_source=chatgpt.com)
          await sms.setStatus(id, 8);

          await client.pushMessage(userId, {
            type: "text",
            text:
              `⚠ หมดเวลารอ OTP สำหรับ ${svcKey.toUpperCase()} แล้ว\n` +
              `ลองกดเมนูแล้วขอเบอร์ใหม่อีกครั้งนะครับ/ค่ะ`,
          });
        }
      } catch (pollErr) {
        console.error("Error while polling code:", pollErr);
        clearInterval(timer);

        await client.pushMessage(userId, {
          type: "text",
          text: "⚠ เกิดข้อผิดพลาดระหว่างรอ OTP กรุณาลองใหม่อีกครั้ง",
        });
      }
    }, intervalMs);
  } catch (err) {
    console.error("Error in handleBuyOtpWithSMSActivate:", err);

    return client.replyMessage(replyToken, {
      type: "text",
      text: "⚠ ระบบมีปัญหาชั่วคราว ลองใหม่อีกครั้งนะครับ/ค่ะ",
    });
  }
}

// ================== start server ==================
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

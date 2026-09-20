import express from "express";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const COZE_TOKEN = process.env.COZE_TOKEN;
const COZE_BOT_ID = process.env.COZE_BOT_ID;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function askCoze(text, userId) {
  const response = await fetch("https://api.coze.com/v3/chat", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${COZE_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      bot_id: COZE_BOT_ID,
      user_id: String(userId),
      stream: false,
      auto_save_history: true,
      additional_messages: [
        {
          role: "user",
          content: text,
          content_type: "text"
        }
      ]
    })
  });

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new Error(
      `Coze error: ${data.msg || response.statusText}`
    );
  }

  const chatId = data.data.id;
  const conversationId = data.data.conversation_id;

  // ننتظر حتى ينتهي Coze من توليد الرد
  for (let i = 0; i < 30; i++) {
    await sleep(1000);

    const statusResponse = await fetch(
      `https://api.coze.com/v3/chat/retrieve?chat_id=${encodeURIComponent(chatId)}&conversation_id=${encodeURIComponent(conversationId)}`,
      {
        headers: {
          "Authorization": `Bearer ${COZE_TOKEN}`
        }
      }
    );

    const statusData = await statusResponse.json();
    const status = statusData?.data?.status;

    if (status === "completed") {
      break;
    }

    if (status === "failed" || status === "canceled") {
      throw new Error(`Coze chat status: ${status}`);
    }

    if (i === 29) {
      throw new Error("Coze response timeout");
    }
  }

  // جلب الرسائل النهائية
  const messagesResponse = await fetch(
    `https://api.coze.com/v3/chat/message/list?chat_id=${encodeURIComponent(chatId)}&conversation_id=${encodeURIComponent(conversationId)}`,
    {
      headers: {
        "Authorization": `Bearer ${COZE_TOKEN}`
      }
    }
  );

  const messagesData = await messagesResponse.json();

  const answer = messagesData?.data?.find(
    message =>
      message.role === "assistant" &&
      message.type === "answer"
  );

  if (!answer?.content) {
    throw new Error("لم يتم العثور على رد من Coze");
  }

  return answer.content;
}

async function sendTelegramMessage(chatId, text, businessConnectionId = null) {
  const body = {
    chat_id: chatId,
    text: text
  };

  if (businessConnectionId) {
    body.business_connection_id = businessConnectionId;
  }

  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();

  if (!data.ok) {
    throw new Error(`Telegram error: ${data.description}`);
  }

  return data;
}

// اختبار السيرفر
app.get("/", (req, res) => {
  res.send("Telegram + Coze server is running!");
});

// Telegram Webhook
app.post("/webhook", async (req, res) => {
  // نرد على Telegram بسرعة
  res.sendStatus(200);

  try {
    const update = req.body;

    // رسائل Telegram Business
    if (update.business_message) {
      const msg = update.business_message;

      const text = msg.text;
      const chatId = msg.chat?.id;
      const businessConnectionId = msg.business_connection_id;

      if (!text || !chatId || !businessConnectionId) {
        return;
      }

      console.log("Business message:", text);

      const answer = await askCoze(text, chatId);

      await sendTelegramMessage(
        chatId,
        answer,
        businessConnectionId
      );

      console.log("Business reply sent");
      return;
    }

    // الرسائل العادية للبوت
    if (update.message) {
      const msg = update.message;

      const text = msg.text;
      const chatId = msg.chat?.id;

      if (!text || !chatId) {
        return;
      }

      console.log("Normal message:", text);

      const answer = await askCoze(text, chatId);

      await sendTelegramMessage(chatId, answer);

      console.log("Normal reply sent");
    }

  } catch (error) {
    console.error("ERROR:", error);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

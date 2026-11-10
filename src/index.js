
const CHARACTERS = "abcdefghjkmnpqrstuvwxyz23456789";

function generateToken(length) {
  const values = crypto.getRandomValues(new Uint8Array(length));

  return Array.from(values, value => CHARACTERS[value % CHARACTERS.length]).join("");
}

function createResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json"
    }
  });
}

function telegramRequest(env, method, payload) {
  return fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

async function getData(env, key) {
  const value = await env.TG.get(key);
  return value ? JSON.parse(value) : null;
}

async function saveData(env, key, value, ttl) {
  const options = ttl ? { expirationTtl: ttl } : undefined;

  await env.TG.put(key, JSON.stringify(value), options);
}

async function getProfilePhoto(env, userId) {
  try {
    const response = await telegramRequest(env, "getUserProfilePhotos", {
      user_id: userId,
      limit: 1
    });

    const result = (await response.json()).result;
    const photos = result.photos[0];

    const photo = photos.find(item => item.width >= 160)
      || photos[photos.length - 1];

    const fileResponse = await telegramRequest(env, "getFile", {
      file_id: photo.file_id
    });

    const filePath = (await fileResponse.json()).result.file_path;

    const imageResponse = await fetch(
      `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`
    );

    if (!imageResponse.ok) return "";

    const imageData = new Uint8Array(await imageResponse.arrayBuffer());

    let binary = "";

    for (let i = 0; i < imageData.length; i += 8192) {
      binary += String.fromCharCode(
        ...imageData.subarray(i, i + 8192)
      );
    }

    return `data:image/jpeg;base64,${btoa(binary)}`;
  } catch {
    return "";
  }
}

async function handleWebhook(request, env, headers) {
  if (
    request.method !== "POST" ||
    !env.WEBHOOK_SECRET ||
    request.headers.get("x-telegram-bot-api-secret-token") !== env.WEBHOOK_SECRET
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  const update = await request.json();
  const message = update.message;

  if (!message || !message.from) {
    return createResponse({ ok: true }, 200, headers);
  }

  const user = message.from;
  const userId = user.id;
  const chatId = message.chat.id;
  const text = (message.text || "").trim();

  const userData = (await getData(env, `u:${userId}`)) || {};

  const contactKeyboard = {
    keyboard: [
      [
        { text: "Share phone", request_contact: true },
        { text: "Share location", request_location: true }
      ]
    ],
    resize_keyboard: true,
    one_time_keyboard: true
  };

  // Connect a Telegram account to the workspace.
  if (text.startsWith("/start ")) {
    const code = text.slice(7).trim();

    const chatResponse = await telegramRequest(env, "getChat", {
      chat_id: userId
    });

    const chat = (await chatResponse.json()).result || {};

    const photo = await getProfilePhoto(env, userId);

    const profile = {
      id: userId,
      first_name: user.first_name,
      last_name: user.last_name,
      username: user.username,
      language_code: user.language_code,
      is_premium: !!user.is_premium,
      bio: chat.bio,
      birthdate: chat.birthdate,
      photo,
      phone: userData.phone,
      location: userData.location
    };

    await saveData(env, `link:${code}`, { prof: profile }, 600);

    await saveData(env, `u:${userId}`, {
      ...userData,
      chat: chatId
    });

    await telegramRequest(env, "sendMessage", {
      chat_id: userId,
      text: "Connected. Return to your workspace, it will detect this automatically.\n\nSend /task <title> to add a task. Optionally share your phone or location with the buttons below.",
      reply_markup: contactKeyboard
    });
  }

  // Save the phone number shared by the user.
  else if (message.contact && message.contact.user_id === userId) {
    await saveData(env, `u:${userId}`, {
      ...userData,
      phone: message.contact.phone_number
    });

    await telegramRequest(env, "sendMessage", {
      chat_id: userId,
      text: "Phone saved."
    });
  }

  // Save the user's shared location.
  else if (message.location) {
    await saveData(env, `u:${userId}`, {
      ...userData,
      location: {
        lat: message.location.latitude,
        lon: message.location.longitude
      }
    });

    await telegramRequest(env, "sendMessage", {
      chat_id: userId,
      text: "Location saved."
    });
  }

  // Handle the regular start command.
  else if (text === "/start" || text.startsWith("/start@")) {
    await telegramRequest(env, "sendMessage", {
      chat_id: userId,
      text: "Hi. To connect, press Connect Telegram in your workspace. It will open this chat with a link code."
    });
  }

  // Add incoming messages to the workspace inbox.
  else if (text && !text.startsWith("/start")) {
    const task = text.replace(/^\/task(@\w+)?\s*/, "");
    const inbox = (await getData(env, `in:${userId}`)) || [];

    if (!task) {
      return createResponse({ ok: true }, 200, headers);
    }

    inbox.push({
      t: task.slice(0, 200),
      ts: Date.now()
    });

    await saveData(env, `in:${userId}`, inbox);

    await telegramRequest(env, "sendMessage", {
      chat_id: userId,
      text: "Added to your inbox: " + task.slice(0, 60)
    });
  }

  return createResponse({ ok: true }, 200, headers);
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get("tok");

  const headers = {
    "Access-Control-Allow-Origin": env.ALLOW_ORIGIN || "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  };

  const respond = (data, status = 200) =>
    createResponse(data, status, headers);

  if (request.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  if (url.pathname === "/health") {
    return respond({
      kv: !!env.TG,
      bot_token: !!env.BOT_TOKEN,
      webhook_secret: !!env.WEBHOOK_SECRET
    });
  }

  if (url.pathname === "/webhook") {
    return handleWebhook(request, env, headers);
  }

  // Exchange the temporary link code for an access token.
  if (url.pathname === "/status") {
    const code = url.searchParams.get("code");
    const link = await getData(env, `link:${code}`);

    if (!link) {
      return respond({ ok: false });
    }

    await env.TG.delete(`link:${code}`);

    const accessToken = generateToken(32);

    await saveData(env, `tok:${accessToken}`, link.prof.id);

    return respond({
      ok: true,
      tok: accessToken,
      profile: link.prof
    });
  }

  // All remaining routes require a valid access token.
  const userId = token && await getData(env, `tok:${token}`);

  if (!userId) {
    return respond({ ok: false, unlinked: true }, 401);
  }

  const userData = (await getData(env, `u:${userId}`)) || {};

  if (url.pathname === "/me") {
    const response = await telegramRequest(env, "getChat", {
      chat_id: userId
    });

    const chat = (await response.json()).result || {};

    return respond({
      ok: true,
      profile: {
        id: userId,
        first_name: chat.first_name,
        last_name: chat.last_name,
        username: chat.username,
        bio: chat.bio,
        birthdate: chat.birthdate,
        phone: userData.phone,
        location: userData.location
      }
    });
  }

  if (url.pathname === "/inbox") {
    const inbox = (await getData(env, `in:${userId}`)) || [];

    if (inbox.length) {
      await saveData(env, `in:${userId}`, []);
    }

    return respond({
      ok: true,
      items: inbox
    });
  }

  if (url.pathname === "/agenda") {
    const agenda = await request.json();
    const previous = (await getData(env, `ag:${userId}`)) || {};

    await saveData(env, `ag:${userId}`, {
      ...agenda,
      sent: previous.sent
    });

    return respond({ ok: true });
  }

  if (url.pathname === "/send") {
    const body = await request.json();

    const response = await telegramRequest(env, "sendMessage", {
      chat_id: userId,
      text: String(body.text).slice(0, 1000)
    });

    return respond(await response.json());
  }

  if (url.pathname === "/unlink") {
    await env.TG.delete(`tok:${token}`);

    for (const prefix of ["u:", "in:", "ag:"]) {
      await env.TG.delete(`${prefix}${userId}`);
    }

    return respond({ ok: true });
  }

  return respond({ ok: false }, 404);
}

async function sendAgendaReminders(env) {
  const { keys } = await env.TG.list({ prefix: "ag:" });

  for (const { name } of keys) {
    const userId = name.slice(3);

    const agenda = await getData(env, name);
    const user = (await getData(env, `u:${userId}`)) || {};

    if (!agenda.digest || !user.chat) continue;

    const localTime = new Date(Date.now() + agenda.tz * 60000);
    const today = localTime.toISOString().slice(0, 10);

    if (
      localTime.getUTCHours() !== agenda.hour ||
      agenda.sent === today
    ) {
      continue;
    }

    const tomorrow = new Date(
      localTime.getTime() + 86400000
    ).toISOString().slice(0, 10);

    const formatTasks = (heading, filter) => {
      const tasks = agenda.tasks.filter(filter);

      if (!tasks.length) return "";

      return (
        heading + "\n" +
        tasks.map(task => "• " + task.t).join("\n") +
        "\n\n"
      );
    };

    const message =
      formatTasks("Overdue", task => task.d < today) +
      formatTasks("Today", task => task.d === today) +
      formatTasks("Tomorrow", task => task.d === tomorrow);

    await telegramRequest(env, "sendMessage", {
      chat_id: user.chat,
      text: "Good morning. " +
        (message ? "\n\n" + message : "Nothing due today.")
    });

    agenda.sent = today;

    await saveData(env, name, agenda);
  }
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },

  async scheduled(controller, env) {
    await sendAgendaReminders(env);
  }
};

const express = require("express");
const { Telegraf, Markup } = require("telegraf");
const { createClient } = require("@supabase/supabase-js");
 
// =====================
// ENV VARIABLES
// =====================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WEBAPP_URL = process.env.WEBAPP_URL || "https://smm-market.vercel.app/";
 
// =====================
// KARTA MA'LUMOTLARI
// =====================
const CARD_NUMBER = "8600 1234 5678 9012";
const CARD_OWNER = "SMM MARKET";
const CARD_BANK = "Uzcard";
 
// =====================
// INIT
// =====================
const bot = new Telegraf(BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const app = express();
app.use(express.json());
 
// =====================
// HELPER: Balansni olish
// =====================
async function getBalance(telegram_id) {
  const { data } = await supabase
    .from("users")
    .select("balance")
    .eq("telegram_id", telegram_id)
    .single();
  return data?.balance || 0;
}
 
// =====================
// HELPER: Foydalanuvchini ro'yxatdan o'tkazish
// =====================
async function registerUser(user) {
  const { error } = await supabase.from("users").upsert(
    {
      telegram_id: user.id,
      username: user.username || null,
      full_name: `${user.first_name} ${user.last_name || ""}`.trim(),
      balance: 0,
    },
    { onConflict: "telegram_id", ignoreDuplicates: true }
  );
  if (error) console.error("Register error:", error.message);
}
 
// =====================
// ASOSIY MENYU
// =====================
function mainMenu(isAdmin = false) {
  const buttons = [
    [Markup.button.webApp("🛒 Do'konni ochish", WEBAPP_URL)],
    ["💰 Hisobim", "➕ Hisob to'ldirish"],
  ];
  if (isAdmin) {
    buttons.push(["⚙️ Admin panel"]);
  }
  return Markup.keyboard(buttons).resize();
}
 
// =====================
// /start COMMAND
// =====================
bot.start(async (ctx) => {
  const user = ctx.from;
  await registerUser(user);
  const isAdmin = String(user.id) === String(ADMIN_ID);
 
  await ctx.reply(
    `👋 Xush kelibsiz, ${user.first_name}!\n\nSMM MARKET'ga xush kelibsiz! 🛒`,
    mainMenu(isAdmin)
  );
});
 
// =====================
// HISOBIM
// =====================
bot.hears("💰 Hisobim", async (ctx) => {
  const balance = await getBalance(ctx.from.id);
  await ctx.reply(
    `💰 <b>Sizning hisobingiz</b>\n\n` +
    `👤 Ism: ${ctx.from.first_name}\n` +
    `🆔 Telegram ID: <code>${ctx.from.id}</code>\n` +
    `💵 Balans: <b>${balance.toLocaleString()} UZS</b>`,
    { parse_mode: "HTML" }
  );
});
 
// =====================
// HISOB TO'LDIRISH
// =====================
bot.hears("➕ Hisob to'ldirish", async (ctx) => {
  await ctx.reply(
    `➕ <b>Hisob to'ldirish</b>\n\n` +
    `Quyidagi karta ma'lumotlariga to'lov qiling:\n\n` +
    `🏦 Bank: <b>${CARD_BANK}</b>\n` +
    `💳 Karta raqami: <code>${CARD_NUMBER}</code>\n` +
    `👤 Egasi: <b>${CARD_OWNER}</b>\n\n` +
    `To'lov qilganingizdan so'ng tugmani bosing 👇`,
    {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("✅ To'lov qildim", "payment_done")],
        [Markup.button.callback("❌ Bekor qilish", "cancel_payment")],
      ]),
    }
  );
});
 
// =====================
// TO'LOV QILDIM TUGMASI
// =====================
bot.action("payment_done", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply("💵 Qancha to'lov qildingiz? (faqat raqam kiriting, masalan: 50000)");
  await supabase.from("user_states").upsert(
    { telegram_id: ctx.from.id, state: "waiting_amount" },
    { onConflict: "telegram_id" }
  );
});
 
bot.action("cancel_payment", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.deleteMessage();
  await ctx.reply("❌ To'lov bekor qilindi.", mainMenu(String(ctx.from.id) === String(ADMIN_ID)));
});
 
// =====================
// XABAR HANDLER
// =====================
bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;
 
  if (text === "⚙️ Admin panel") {
    if (String(userId) !== String(ADMIN_ID)) {
      return ctx.reply("❌ Sizda ruxsat yo'q!");
    }
    return ctx.reply(
      "⚙️ <b>Admin Panel</b>",
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("👥 Foydalanuvchilar", "admin_users")],
          [Markup.button.callback("📦 Buyurtmalar", "admin_orders")],
          [Markup.button.callback("💳 To'lov so'rovlari", "admin_payments")],
          [Markup.button.callback("💰 Statistika", "admin_stats")],
        ]),
      }
    );
  }
 
  const { data: stateData } = await supabase
    .from("user_states")
    .select("state")
    .eq("telegram_id", userId)
    .single();
 
  const state = stateData?.state;
 
  if (state === "waiting_amount") {
    const amount = parseInt(text.replace(/\s/g, "").replace(/,/g, ""));
    if (isNaN(amount) || amount <= 0) {
      return ctx.reply("❌ Noto'g'ri summa. Faqat raqam kiriting (masalan: 50000)");
    }
    if (amount < 1000) {
      return ctx.reply("❌ Minimal to'lov miqdori 1,000 UZS.");
    }
 
    await supabase.from("user_states").upsert(
      { telegram_id: userId, state: "waiting_check", pending_amount: amount },
      { onConflict: "telegram_id" }
    );
 
    await ctx.reply(
      `✅ Summa qabul qilindi: <b>${amount.toLocaleString()} UZS</b>\n\n` +
      `📸 Iltimos, to'lov haqidagi <b>chekni yuboring</b> (rasm yoki screenshot)`,
      { parse_mode: "HTML" }
    );
    return;
  }
});
 
// =====================
// CHEK (RASM) HANDLER
// =====================
bot.on(["photo", "document"], async (ctx) => {
  const userId = ctx.from.id;
 
  const { data: stateData } = await supabase
    .from("user_states")
    .select("state, pending_amount")
    .eq("telegram_id", userId)
    .single();
 
  if (stateData?.state !== "waiting_check") return;
 
  const amount = stateData.pending_amount;
  const user = ctx.from;
 
  const { data: payReq, error } = await supabase
    .from("payment_requests")
    .insert({
      user_id: userId,
      username: user.username || null,
      full_name: `${user.first_name} ${user.last_name || ""}`.trim(),
      amount: amount,
      status: "pending",
    })
    .select()
    .single();
 
  if (error) {
    console.error("Payment request error:", error.message);
    return ctx.reply("❌ Xatolik yuz berdi. Qayta urinib ko'ring.");
  }
 
  await supabase.from("user_states").upsert(
    { telegram_id: userId, state: null, pending_amount: null },
    { onConflict: "telegram_id" }
  );
 
  await ctx.reply(
    `✅ Chekingiz qabul qilindi!\n\n` +
    `💵 Summa: <b>${amount.toLocaleString()} UZS</b>\n` +
    `⏳ Admin tekshirib, hisobingizga qo'shadi.\n\nKuting, tez orada xabar beramiz! 🙏`,
    { parse_mode: "HTML" }
  );
 
  const reqId = payReq.id;
  const caption =
    `💳 <b>Yangi to'lov so'rovi!</b>\n\n` +
    `👤 Ism: <b>${user.first_name} ${user.last_name || ""}</b>\n` +
    `🆔 Telegram ID: <code>${userId}</code>\n` +
    `📛 Username: ${user.username ? "@" + user.username : "yo'q"}\n` +
    `💵 Summa: <b>${amount.toLocaleString()} UZS</b>\n` +
    `🕐 Vaqt: ${new Date().toLocaleString("uz-UZ")}\n` +
    `🆔 So'rov ID: <code>${reqId}</code>`;
 
  const keyboard = {
    inline_keyboard: [[
      { text: "✅ Tasdiqlash", callback_data: `pay_approve_${reqId}_${userId}_${amount}` },
      { text: "❌ Rad etish", callback_data: `pay_cancel_${reqId}_${userId}` },
    ]],
  };
 
  try {
    if (ctx.message.photo) {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      await bot.telegram.sendPhoto(ADMIN_ID, photo.file_id, { caption, parse_mode: "HTML", reply_markup: keyboard });
    } else if (ctx.message.document) {
      await bot.telegram.sendDocument(ADMIN_ID, ctx.message.document.file_id, { caption, parse_mode: "HTML", reply_markup: keyboard });
    }
  } catch (e) {
    console.error("Admin message error:", e.message);
  }
});
 
// =====================
// ADMIN: TO'LOV TASDIQLASH
// =====================
bot.action(/^pay_approve_(.+)_(\d+)_(\d+)$/, async (ctx) => {
  const reqId = ctx.match[1];
  const userId = parseInt(ctx.match[2]);
  const amount = parseInt(ctx.match[3]);
 
  if (String(ctx.from.id) !== String(ADMIN_ID)) {
    return ctx.answerCbQuery("❌ Ruxsat yo'q!");
  }
 
  const currentBalance = await getBalance(userId);
  const newBalance = currentBalance + amount;
 
  const { error: balErr } = await supabase
    .from("users")
    .update({ balance: newBalance })
    .eq("telegram_id", userId);
 
  if (balErr) {
    console.error("Balance update error:", balErr.message);
    return ctx.answerCbQuery("❌ Xatolik!");
  }
 
  await supabase.from("payment_requests").update({ status: "approved" }).eq("id", reqId);
 
  try {
    await ctx.editMessageCaption(
      ctx.callbackQuery.message.caption + `\n\n✅ <b>TASDIQLANDI</b> (+${amount.toLocaleString()} UZS)`,
      { parse_mode: "HTML" }
    );
  } catch (e) {}
 
  await bot.telegram.sendMessage(
    userId,
    `✅ <b>To'lovingiz tasdiqlandi!</b>\n\n` +
    `💵 Hisobingizga <b>${amount.toLocaleString()} UZS</b> qo'shildi.\n` +
    `💰 Joriy balans: <b>${newBalance.toLocaleString()} UZS</b>\n\nRahmat! 🙏`,
    { parse_mode: "HTML" }
  );
 
  await ctx.answerCbQuery("✅ Tasdiqlandi!");
});
 
// =====================
// ADMIN: TO'LOV RAD ETISH
// =====================
bot.action(/^pay_cancel_(.+)_(\d+)$/, async (ctx) => {
  const reqId = ctx.match[1];
  const userId = parseInt(ctx.match[2]);
 
  if (String(ctx.from.id) !== String(ADMIN_ID)) {
    return ctx.answerCbQuery("❌ Ruxsat yo'q!");
  }
 
  await supabase.from("payment_requests").update({ status: "rejected" }).eq("id", reqId);
 
  try {
    await ctx.editMessageCaption(
      ctx.callbackQuery.message.caption + "\n\n❌ <b>RAD ETILDI</b>",
      { parse_mode: "HTML" }
    );
  } catch (e) {}
 
  await bot.telegram.sendMessage(
    userId,
    `❌ <b>Arizangiz qabul qilinmadi.</b>\n\nTo'lovingiz tasdiqlanmadi. Agar xatolik bo'lsa, qayta urinib ko'ring yoki admin bilan bog'laning.`,
    { parse_mode: "HTML" }
  );
 
  await ctx.answerCbQuery("❌ Rad etildi!");
});
 
// =====================
// WEB APP DATA — BUYURTMA (BALANSDAN YECHISH)
// =====================
bot.on("web_app_data", async (ctx) => {
  let orderData;
  try {
    orderData = JSON.parse(ctx.webAppData.data.text());
  } catch (e) {
    return ctx.reply("❌ Ma'lumot noto'g'ri formatda keldi.");
  }
 
  const { orderId, items, totalPrice, contact } = orderData;
  const userId = ctx.from.id;
 
  // Balansni tekshirish
  const currentBalance = await getBalance(userId);
  if (currentBalance < totalPrice) {
    return ctx.reply(
      `❌ <b>Balans yetarli emas!</b>\n\n` +
      `💰 Sizning balansingiz: <b>${currentBalance.toLocaleString()} UZS</b>\n` +
      `🛒 Buyurtma narxi: <b>${totalPrice.toLocaleString()} UZS</b>\n\n` +
      `➕ Hisobingizni to'ldiring va qayta urinib ko'ring.`,
      { parse_mode: "HTML" }
    );
  }
 
  // Balansdan yechish
  const newBalance = currentBalance - totalPrice;
  const { error: balErr } = await supabase
    .from("users")
    .update({ balance: newBalance })
    .eq("telegram_id", userId);
 
  if (balErr) {
    console.error("Balance deduct error:", balErr.message);
    return ctx.reply("❌ Xatolik yuz berdi. Qayta urinib ko'ring.");
  }
 
  // Mahsulot nomlarini birlashtirish
  const productNames = items.map(i => `${i.product} (${i.variant})`).join(', ');
 
  // Buyurtmani saqlash
  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      user_id: userId,
      product_name: productNames,
      amount: totalPrice,
      product_id: orderId,
      status: "pending",
    })
    .select()
    .single();
 
  if (error) {
    // Xatolik bo'lsa pulni qaytaramiz
    await supabase.from("users").update({ balance: currentBalance }).eq("telegram_id", userId);
    console.error("Order insert error:", error.message);
    return ctx.reply("❌ Buyurtma saqlashda xatolik. Pulingiz qaytarildi.");
  }
 
  // Foydalanuvchiga tasdiqlash
  await ctx.reply(
    `✅ <b>Buyurtmangiz qabul qilindi!</b>\n\n` +
    `🆔 Buyurtma ID: <code>${orderId}</code>\n` +
    `📦 Mahsulotlar: ${productNames}\n` +
    `💰 To'landi: <b>${totalPrice.toLocaleString()} UZS</b>\n` +
    `💵 Qolgan balans: <b>${newBalance.toLocaleString()} UZS</b>\n` +
    `⏳ Admin tekshirib, tez orada bajaradi!`,
    { parse_mode: "HTML" }
  );
 
  // Admin ga yuborish
  let adminText =
    `🛒 <b>Yangi buyurtma!</b>\n\n` +
    `👤 <a href="tg://user?id=${userId}">${ctx.from.first_name}</a> (ID: <code>${userId}</code>)\n` +
    `🆔 Order ID: <code>${orderId}</code>\n` +
    `💰 Jami: <b>${totalPrice.toLocaleString()} UZS</b>\n`;
 
  if (contact) adminText += `📞 Aloqa: ${contact}\n`;
  adminText += `\n📦 <b>Mahsulotlar:</b>\n`;
  items.forEach((item, i) => {
    adminText += `${i + 1}. ${item.product} — ${item.variant}\n`;
    adminText += `   💵 ${item.price} | 📝 ${item.userInput}\n`;
  });
 
  await bot.telegram.sendMessage(ADMIN_ID, adminText, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: "✅ Tasdiqlash", callback_data: `approve_${order.id}_${userId}` },
        { text: "❌ Bekor qilish", callback_data: `cancel_${order.id}_${userId}` },
      ]],
    },
  });
});
 
// =====================
// ADMIN PANEL: FOYDALANUVCHILAR
// =====================
bot.action("admin_users", async (ctx) => {
  if (String(ctx.from.id) !== String(ADMIN_ID)) return ctx.answerCbQuery("❌ Ruxsat yo'q!");
 
  const { data: users, count } = await supabase
    .from("users")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(10);
 
  let text = `👥 <b>Foydalanuvchilar</b> (jami: ${count})\n\n`;
  users?.forEach((u, i) => {
    text += `${i + 1}. ${u.full_name || "Nomsiz"} ${u.username ? "@" + u.username : ""}\n`;
    text += `    💰 Balans: ${(u.balance || 0).toLocaleString()} UZS | ID: <code>${u.telegram_id}</code>\n\n`;
  });
 
  await ctx.answerCbQuery();
  await ctx.reply(text, { parse_mode: "HTML" });
});
 
// =====================
// ADMIN PANEL: BUYURTMALAR
// =====================
bot.action("admin_orders", async (ctx) => {
  if (String(ctx.from.id) !== String(ADMIN_ID)) return ctx.answerCbQuery("❌ Ruxsat yo'q!");
 
  const { data: orders } = await supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10);
 
  let text = `📦 <b>So'nggi buyurtmalar</b>\n\n`;
  if (!orders?.length) {
    text += "Hozircha buyurtma yo'q.";
  } else {
    orders.forEach((o, i) => {
      const statusEmoji = o.status === "completed" ? "✅" : o.status === "cancelled" ? "❌" : "⏳";
      text += `${i + 1}. ${statusEmoji} <b>${o.product_name}</b>\n`;
      text += `    💰 ${(o.amount || 0).toLocaleString()} UZS | ID: <code>${o.user_id}</code>\n\n`;
    });
  }
 
  await ctx.answerCbQuery();
  await ctx.reply(text, { parse_mode: "HTML" });
});
 
// =====================
// ADMIN PANEL: TO'LOV SO'ROVLARI
// =====================
bot.action("admin_payments", async (ctx) => {
  if (String(ctx.from.id) !== String(ADMIN_ID)) return ctx.answerCbQuery("❌ Ruxsat yo'q!");
 
  const { data: payments } = await supabase
    .from("payment_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10);
 
  let text = `💳 <b>So'nggi to'lov so'rovlari</b>\n\n`;
  if (!payments?.length) {
    text += "Hozircha so'rov yo'q.";
  } else {
    payments.forEach((p, i) => {
      const statusEmoji = p.status === "approved" ? "✅" : p.status === "rejected" ? "❌" : "⏳";
      text += `${i + 1}. ${statusEmoji} ${p.full_name || "Nomsiz"}\n`;
      text += `    💵 ${(p.amount || 0).toLocaleString()} UZS | ID: <code>${p.user_id}</code>\n\n`;
    });
  }
 
  await ctx.answerCbQuery();
  await ctx.reply(text, { parse_mode: "HTML" });
});
 
// =====================
// ADMIN PANEL: STATISTIKA
// =====================
bot.action("admin_stats", async (ctx) => {
  if (String(ctx.from.id) !== String(ADMIN_ID)) return ctx.answerCbQuery("❌ Ruxsat yo'q!");
 
  const { count: userCount } = await supabase.from("users").select("*", { count: "exact", head: true });
  const { count: orderCount } = await supabase.from("orders").select("*", { count: "exact", head: true });
  const { data: approvedPayments } = await supabase.from("payment_requests").select("amount").eq("status", "approved");
  const totalDeposit = approvedPayments?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0;
  const { count: pendingCount } = await supabase.from("payment_requests").select("*", { count: "exact", head: true }).eq("status", "pending");
 
  await ctx.answerCbQuery();
  await ctx.reply(
    `📊 <b>Statistika</b>\n\n` +
    `👥 Jami foydalanuvchilar: <b>${userCount}</b>\n` +
    `📦 Jami buyurtmalar: <b>${orderCount}</b>\n` +
    `💰 Jami tasdiqlangan to'lovlar: <b>${totalDeposit.toLocaleString()} UZS</b>\n` +
    `⏳ Kutilayotgan to'lovlar: <b>${pendingCount}</b>`,
    { parse_mode: "HTML" }
  );
});
 
// =====================
// BUYURTMA TASDIQLASH
// =====================
bot.action(/^approve_(.+)_(\d+)$/, async (ctx) => {
  const orderId = ctx.match[1];
  const userId = ctx.match[2];
 
  if (String(ctx.from.id) !== String(ADMIN_ID)) {
    return ctx.answerCbQuery("❌ Ruxsat yo'q!");
  }
 
  const { error } = await supabase.from("orders").update({ status: "completed" }).eq("id", orderId);
  if (error) return ctx.answerCbQuery("❌ Xatolik!");
 
  try {
    await ctx.editMessageText(ctx.callbackQuery.message.text + "\n\n✅ <b>TASDIQLANDI</b>", { parse_mode: "HTML" });
  } catch (e) {}
 
  await bot.telegram.sendMessage(
    userId,
    `✅ <b>Buyurtmangiz tasdiqlandi!</b>\n\nTez orada yetkaziladi. Rahmat! 🙏`,
    { parse_mode: "HTML" }
  );
  await ctx.answerCbQuery("✅ Tasdiqlandi!");
});
 
// =====================
// BUYURTMA BEKOR QILISH — PULNI QAYTARISH
// =====================
bot.action(/^cancel_(.+)_(\d+)$/, async (ctx) => {
  const orderId = ctx.match[1];
  const userId = parseInt(ctx.match[2]);
 
  if (String(ctx.from.id) !== String(ADMIN_ID)) {
    return ctx.answerCbQuery("❌ Ruxsat yo'q!");
  }
 
  // Buyurtma ma'lumotlarini olish
  const { data: order } = await supabase.from("orders").select("amount, status").eq("id", orderId).single();
 
  if (!order) return ctx.answerCbQuery("❌ Buyurtma topilmadi!");
  if (order.status === "cancelled") return ctx.answerCbQuery("⚠️ Allaqachon bekor qilingan!");
 
  // Statusni yangilash
  await supabase.from("orders").update({ status: "cancelled" }).eq("id", orderId);
 
  // Balansni qaytarish
  const currentBalance = await getBalance(userId);
  const restoredBalance = currentBalance + order.amount;
  await supabase.from("users").update({ balance: restoredBalance }).eq("telegram_id", userId);
 
  try {
    await ctx.editMessageText(ctx.callbackQuery.message.text + "\n\n❌ <b>BEKOR QILINDI</b>", { parse_mode: "HTML" });
  } catch (e) {}
 
  await bot.telegram.sendMessage(
    userId,
    `❌ <b>Buyurtmangiz bekor qilindi.</b>\n\n` +
    `💰 <b>${order.amount.toLocaleString()} UZS</b> hisobingizga qaytarildi.\n` +
    `💵 Joriy balans: <b>${restoredBalance.toLocaleString()} UZS</b>\n\n` +
    `Savollar bo'lsa admin bilan bog'laning.`,
    { parse_mode: "HTML" }
  );
 
  await ctx.answerCbQuery("❌ Bekor qilindi, pul qaytarildi!");
});
 
// =====================
// EXPRESS SERVER
// =====================
app.get("/", (req, res) => res.json({ status: "Bot ishlayapti ✅" }));
 
app.listen(PORT, async () => {
  console.log(`Server ${PORT} portda ishlamoqda`);
  await bot.telegram.deleteWebhook({ drop_pending_updates: true });
  console.log("Webhook o'chirildi ✅");
  bot.launch({ dropPendingUpdates: true });
  console.log("Bot polling mode da ishga tushdi ✅");
});
 
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

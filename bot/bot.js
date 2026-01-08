import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { Telegraf, Markup } from "telegraf";

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;

console.log("BOT_TOKEN present:", !!BOT_TOKEN);
console.log("WEBAPP_URL:", WEBAPP_URL);

if (!BOT_TOKEN || !WEBAPP_URL) {
  throw new Error("BOT_TOKEN or WEBAPP_URL is missing");
}

const bot = new Telegraf(BOT_TOKEN);

bot.start(async (ctx) => {
  await ctx.reply(
    "Добро пожаловать 🚀\nНажми PLAY чтобы начать",
    Markup.inlineKeyboard([Markup.button.webApp("▶️ PLAY", WEBAPP_URL)])
  );
});

bot.command("play", async (ctx) => {
  await ctx.reply(
    "Открыть игру:",
    Markup.inlineKeyboard([Markup.button.webApp("▶️ PLAY", WEBAPP_URL)])
  );
});

bot.launch();
console.log("🤖 Bot started");

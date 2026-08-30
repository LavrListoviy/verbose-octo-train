import { randomUUID } from "node:crypto";

import { Bot, type Context } from "grammy";
import type { Logger } from "pino";

import { AuditService } from "./audit/service.js";
import type { RegistrationDraft } from "./db/schema.js";
import { runWithRequestContext } from "./observability/context.js";
import { requestLogger } from "./observability/logger.js";
import { confirmationKeyboard, formatDraft, promptForStep, skipKeyboard } from "./registration/prompts.js";
import { RegistrationRepository } from "./registration/repository.js";
import { isAtLeastAge, MINIMUM_AGE, normalizeOptionalText, parseBirthDate } from "./registration/validation.js";

const optionalSteps: RegistrationDraft["step"][] = ["avatar", "bio", "city", "country"];

export function createBot(
  token: string,
  registrations: RegistrationRepository,
  audit: AuditService,
  logger: Logger,
): Bot {
  const bot = new Bot(token);

  bot.use((ctx, next) => {
    const requestContext = {
      correlationId: randomUUID(),
      telegramUpdateId: BigInt(ctx.update.update_id),
      ...(ctx.from ? { actorTelegramId: BigInt(ctx.from.id) } : {}),
    };

    return runWithRequestContext(requestContext, async () => {
      const log = requestLogger(logger);
      const startedAt = performance.now();
      const updateType = Object.keys(ctx.update).find((key) => key !== "update_id") ?? "unknown";
      await audit.record({
        action: "telegram.update.received",
        entityType: "telegram_update",
        entityId: ctx.update.update_id.toString(),
        metadata: { update: ctx.update },
      });
      log.debug({ updateType }, "Telegram update received");

      try {
        await next();
        log.info({ durationMs: Math.round(performance.now() - startedAt) }, "Telegram update handled");
      } catch (error) {
        log.error(
          { err: error, durationMs: Math.round(performance.now() - startedAt) },
          "Telegram update failed",
        );
        throw error;
      }
    });
  });

  bot.command("start", async (ctx) => {
    if (!ctx.from) return;
    const telegramId = BigInt(ctx.from.id);
    if (await registrations.isRegistered(telegramId)) {
      await ctx.reply("Аккаунт уже создан. Управление личным кабинетом появится в следующем этапе.");
      return;
    }

    const draft = await registrations.start(telegramId);
    await ctx.reply("Начнём регистрацию. Обязательны только имя и дата рождения.");
    await sendPrompt(ctx, draft);
  });

  bot.callbackQuery("reg:skip", async (ctx) => {
    await ctx.answerCallbackQuery();
    const telegramId = BigInt(ctx.from.id);
    const draft = await registrations.getDraft(telegramId);
    if (!draft || !optionalSteps.includes(draft.step)) {
      await ctx.reply("Сейчас этот шаг нельзя пропустить. Отправь /start, чтобы продолжить.");
      return;
    }

    const nextStep = nextOptionalStep(draft.step);
    const updated = await registrations.update(telegramId, { step: nextStep });
    await sendPrompt(ctx, updated);
  });

  bot.callbackQuery("reg:restart", async (ctx) => {
    await ctx.answerCallbackQuery();
    const draft = await registrations.restart(BigInt(ctx.from.id));
    await ctx.reply("Хорошо, заполним заново.");
    await sendPrompt(ctx, draft);
  });

  bot.callbackQuery("reg:confirm", async (ctx) => {
    await ctx.answerCallbackQuery();
    const telegramId = BigInt(ctx.from.id);
    let draft = await registrations.getDraft(telegramId);
    if (!draft || draft.step !== "confirmation") {
      await ctx.reply("Анкета не готова. Отправь /start, чтобы продолжить.");
      return;
    }

    if (!draft.avatarFileId) {
      const photos = await ctx.api.getUserProfilePhotos(ctx.from.id, { limit: 1 });
      const profilePhoto = photos.photos[0]?.at(-1)?.file_id;
      if (profilePhoto) {
        draft = await registrations.update(telegramId, { avatarFileId: profilePhoto });
      }
    }

    await registrations.complete(
      { id: telegramId, ...(ctx.from.username ? { username: ctx.from.username } : {}) },
      draft,
    );
    await ctx.reply("Аккаунт создан.");
  });

  bot.on("message:photo", async (ctx) => {
    const telegramId = BigInt(ctx.from.id);
    const draft = await registrations.getDraft(telegramId);
    if (!draft || draft.step !== "avatar") return;

    const largestPhoto = ctx.message.photo.at(-1);
    if (!largestPhoto) return;
    const updated = await registrations.update(telegramId, {
      avatarFileId: largestPhoto.file_id,
      step: "bio",
    });
    await sendPrompt(ctx, updated);
  });

  bot.on("message:text", async (ctx) => {
    const telegramId = BigInt(ctx.from.id);
    const draft = await registrations.getDraft(telegramId);
    if (!draft) {
      await ctx.reply("Отправь /start, чтобы начать регистрацию.");
      return;
    }

    const text = ctx.message.text;
    switch (draft.step) {
      case "display_name": {
        const displayName = normalizeOptionalText(text, 64);
        if (!displayName || displayName.length < 2) {
          await ctx.reply("Имя должно содержать от 2 до 64 символов.");
          return;
        }
        await sendPrompt(
          ctx,
          await registrations.update(telegramId, { displayName, step: "birth_date" }),
        );
        return;
      }
      case "birth_date": {
        const birthDate = parseBirthDate(text);
        if (!birthDate) {
          await ctx.reply("Не удалось разобрать дату. Используй формат ДД.ММ.ГГГГ, например 17.04.1998.");
          return;
        }
        if (!isAtLeastAge(birthDate, MINIMUM_AGE)) {
          await ctx.reply("Регистрация доступна только пользователям от 16 лет.");
          return;
        }
        await sendPrompt(
          ctx,
          await registrations.update(telegramId, { birthDate, step: "avatar" }),
        );
        return;
      }
      case "avatar":
        await ctx.reply("На этом шаге нужна фотография. Либо нажми «Пропустить».", {
          reply_markup: skipKeyboard,
        });
        return;
      case "bio":
        await saveOptionalText(ctx, registrations, draft, text, 500, "city");
        return;
      case "city":
        await saveOptionalText(ctx, registrations, draft, text, 100, "country");
        return;
      case "country":
        await saveOptionalText(ctx, registrations, draft, text, 100, "confirmation");
        return;
      case "confirmation":
        await ctx.reply("Используй кнопки под анкетой: создать аккаунт или заполнить заново.");
    }
  });

  bot.catch(({ error }) => {
    requestLogger(logger).error({ err: error }, "Unhandled bot error");
  });

  return bot;
}

async function saveOptionalText(
  ctx: Context & { from: NonNullable<Context["from"]> },
  registrations: RegistrationRepository,
  draft: RegistrationDraft,
  text: string,
  maxLength: number,
  nextStep: RegistrationDraft["step"],
): Promise<void> {
  const value = normalizeOptionalText(text, maxLength);
  if (!value) {
    await ctx.reply(`Поле должно содержать не больше ${maxLength} символов.`);
    return;
  }

  const field = draft.step as "bio" | "city" | "country";
  const updated = await registrations.update(BigInt(ctx.from.id), { [field]: value, step: nextStep });
  await sendPrompt(ctx, updated);
}

async function sendPrompt(ctx: Context, draft: RegistrationDraft): Promise<void> {
  if (draft.step === "confirmation") {
    await ctx.reply(formatDraft(draft), { reply_markup: confirmationKeyboard });
    return;
  }

  await ctx.reply(promptForStep(draft.step), {
    ...(optionalSteps.includes(draft.step) ? { reply_markup: skipKeyboard } : {}),
  });
}

function nextOptionalStep(step: RegistrationDraft["step"]): RegistrationDraft["step"] {
  switch (step) {
    case "avatar":
      return "bio";
    case "bio":
      return "city";
    case "city":
      return "country";
    case "country":
      return "confirmation";
    default:
      throw new Error(`Step ${step} is not optional`);
  }
}

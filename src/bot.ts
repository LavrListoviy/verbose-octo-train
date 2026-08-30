import { randomUUID } from "node:crypto";

import { Bot, type Context } from "grammy";
import type { Logger } from "pino";

import { AuditService } from "./audit/service.js";
import type { RegistrationDraft } from "./db/schema.js";
import { runWithRequestContext } from "./observability/context.js";
import { requestLogger } from "./observability/logger.js";
import {
  confirmationKeyboard,
  formatDraft,
  locationCandidatesKeyboard,
  promptForStep,
  skipKeyboard,
} from "./registration/prompts.js";
import {
  GeographicLookupError,
  type GeographicCandidate,
  NominatimGeocoder,
} from "./registration/geocoder.js";
import { RegistrationRepository } from "./registration/repository.js";
import { isAtLeastAge, MINIMUM_AGE, normalizeOptionalText, parseBirthDate } from "./registration/validation.js";

const optionalSteps: RegistrationDraft["step"][] = ["avatar", "bio", "country", "city"];

export function createBot(
  token: string,
  registrations: RegistrationRepository,
  audit: AuditService,
  logger: Logger,
  geocoder: NominatimGeocoder,
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

    const updated = await skipOptionalStep(registrations, telegramId, draft);
    await sendPrompt(ctx, updated);
  });

  bot.callbackQuery(/^reg:location:(country|city):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, candidateKind, candidateIndex] = ctx.match;
    const telegramId = BigInt(ctx.from.id);
    const draft = await registrations.getDraft(telegramId);
    const candidate = draft?.locationCandidates?.[Number(candidateIndex)];
    if (!draft || !candidate || candidate.kind !== candidateKind || !isCandidateForStep(draft.step, candidate)) {
      await ctx.reply("Этот вариант уже не актуален. Отправь значение ещё раз или нажми «Пропустить».");
      return;
    }

    if (candidate.kind === "country") {
      const updated = await registrations.update(telegramId, {
        country: candidate.country,
        countryCode: candidate.countryCode,
        city: null,
        cityOsmType: null,
        cityOsmId: null,
        locationCandidates: null,
        step: "city",
      });
      await sendPrompt(ctx, updated);
      return;
    }

    if (candidate.kind !== "city" || candidate.countryCode !== draft.countryCode) {
      await ctx.reply("Город не относится к выбранной стране. Введи город ещё раз.");
      return;
    }

    const updated = await registrations.update(telegramId, {
      city: candidate.city,
      cityOsmType: candidate.cityOsmType,
      cityOsmId: candidate.cityOsmId,
      locationCandidates: null,
      step: "confirmation",
    });
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
        await saveBio(ctx, registrations, text);
        return;
      case "country":
        await findCountry(ctx, registrations, geocoder, text);
        return;
      case "city":
        await findCity(ctx, registrations, draft, geocoder, text);
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

async function saveBio(
  ctx: Context & { from: NonNullable<Context["from"]> },
  registrations: RegistrationRepository,
  text: string,
): Promise<void> {
  const value = normalizeOptionalText(text, 500);
  if (!value) {
    await ctx.reply("Поле должно содержать не больше 500 символов.");
    return;
  }

  const updated = await registrations.update(BigInt(ctx.from.id), { bio: value, step: "country" });
  await sendPrompt(ctx, updated);
}

async function findCountry(
  ctx: Context & { from: NonNullable<Context["from"]> },
  registrations: RegistrationRepository,
  geocoder: NominatimGeocoder,
  text: string,
): Promise<void> {
  const query = normalizeOptionalText(text, 100);
  if (!query) {
    await ctx.reply("Укажи страну не длиннее 100 символов или нажми «Пропустить».");
    return;
  }

  try {
    const candidates = await geocoder.findCountries(query);
    if (!candidates.length) {
      await ctx.reply("Такую страну не нашёл. Проверь название или нажми «Пропустить».");
      return;
    }
    await presentLocationCandidates(ctx, registrations, candidates, "Выбери страну:");
  } catch (error) {
    await replyGeocoderError(ctx, error);
  }
}

async function findCity(
  ctx: Context & { from: NonNullable<Context["from"]> },
  registrations: RegistrationRepository,
  draft: RegistrationDraft,
  geocoder: NominatimGeocoder,
  text: string,
): Promise<void> {
  const query = normalizeOptionalText(text, 100);
  if (!query) {
    await ctx.reply("Укажи город не длиннее 100 символов или нажми «Пропустить».");
    return;
  }
  if (!draft.countryCode) {
    await ctx.reply("Сначала выбери страну или начни регистрацию заново через /start.");
    return;
  }

  try {
    const candidates = await geocoder.findCities(query, draft.countryCode);
    if (!candidates.length) {
      await ctx.reply("В выбранной стране такой город не нашёл. Проверь название или нажми «Пропустить».");
      return;
    }
    await presentLocationCandidates(ctx, registrations, candidates, "Выбери город:");
  } catch (error) {
    await replyGeocoderError(ctx, error);
  }
}

async function presentLocationCandidates(
  ctx: Context & { from: NonNullable<Context["from"]> },
  registrations: RegistrationRepository,
  candidates: GeographicCandidate[],
  message: string,
): Promise<void> {
  await registrations.update(BigInt(ctx.from.id), { locationCandidates: candidates });
  await ctx.reply(`${message}\n\nДанные поиска: © OpenStreetMap contributors.`, {
    reply_markup: locationCandidatesKeyboard(candidates),
  });
}

async function replyGeocoderError(ctx: Context, error: unknown): Promise<void> {
  if (error instanceof GeographicLookupError) {
    await ctx.reply("Сервис поиска локаций временно недоступен. Попробуй ещё раз позже или нажми «Пропустить».");
    return;
  }
  throw error;
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

async function skipOptionalStep(
  registrations: RegistrationRepository,
  telegramId: bigint,
  draft: RegistrationDraft,
): Promise<RegistrationDraft> {
  switch (draft.step) {
    case "avatar":
      return registrations.update(telegramId, { step: "bio" });
    case "bio":
      return registrations.update(telegramId, { step: "country" });
    case "country":
      return registrations.update(telegramId, {
        country: null,
        countryCode: null,
        city: null,
        cityOsmType: null,
        cityOsmId: null,
        locationCandidates: null,
        step: "confirmation",
      });
    case "city":
      return registrations.update(telegramId, {
        city: null,
        cityOsmType: null,
        cityOsmId: null,
        locationCandidates: null,
        step: "confirmation",
      });
    default:
      throw new Error(`Step ${draft.step} is not optional`);
  }
}

function isCandidateForStep(
  step: RegistrationDraft["step"],
  candidate: GeographicCandidate,
): boolean {
  return (step === "country" && candidate.kind === "country") || (step === "city" && candidate.kind === "city");
}

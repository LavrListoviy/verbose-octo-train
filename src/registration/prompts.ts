import { InlineKeyboard } from "grammy";

import type { RegistrationDraft } from "../db/schema.js";

export const skipKeyboard = new InlineKeyboard().text("Пропустить", "reg:skip");
export const confirmationKeyboard = new InlineKeyboard()
  .text("Создать аккаунт", "reg:confirm")
  .row()
  .text("Заполнить заново", "reg:restart");

export function promptForStep(step: RegistrationDraft["step"]): string {
  switch (step) {
    case "display_name":
      return "Как тебя показывать другим пользователям? Отправь отображаемое имя (2–64 символа).";
    case "birth_date":
      return "Укажи дату рождения в формате ДД.ММ.ГГГГ. Регистрация доступна только с 16 лет.";
    case "avatar":
      return "Отправь отдельную фотографию для аватара. Если пропустишь, попробую взять текущий аватар Telegram.";
    case "bio":
      return "Расскажи немного о себе (до 500 символов).";
    case "city":
      return "В каком городе ты живёшь?";
    case "country":
      return "Укажи страну.";
    case "confirmation":
      return "Проверь анкету перед созданием аккаунта.";
  }
}

export function formatDraft(draft: RegistrationDraft): string {
  return [
    "Проверь анкету:",
    "",
    `Имя: ${draft.displayName ?? "—"}`,
    `Дата рождения: ${formatDate(draft.birthDate)}`,
    `Аватар: ${draft.avatarFileId ? "загружен" : "профиль Telegram или отсутствует"}`,
    `О себе: ${draft.bio ?? "—"}`,
    `Город: ${draft.city ?? "—"}`,
    `Страна: ${draft.country ?? "—"}`,
  ].join("\n");
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

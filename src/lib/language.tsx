"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

export type Language = "en" | "ru";

const translations: Record<string, { en: string; ru: string }> = {
  "Open World · Street View": { en: "Open World · Street View", ru: "Открытый мир · Street View" },
  "Hide somewhere in the world. Let your friends find you on Street View.": { en: "Hide somewhere in the world. Let your friends find you on Street View.", ru: "Спрячьтесь в любой точке мира. Пусть друзья найдут вас в Street View." },
  "Start a new game": { en: "Start a new game", ru: "Новая игра" },
  "Your name": { en: "Your name", ru: "Ваше имя" },
  "Pick your avatar": { en: "Pick your avatar", ru: "Выберите аватар" },
  Settings: { en: "Settings", ru: "Настройки" },
  "Creating…": { en: "Creating…", ru: "Создание…" },
  "Join with a code": { en: "Join with a code", ru: "Войти по коду" },
  "Join game": { en: "Join game", ru: "Войти в игру" },
  "Game settings": { en: "Game settings", ru: "Настройки игры" },
  "Text chat": { en: "Text chat", ru: "Текстовый чат" },
  "Voice chat": { en: "Voice chat", ru: "Голосовой чат" },
  "Your settings": { en: "Your settings", ru: "Ваши настройки" },
  "Sound effects": { en: "Sound effects", ru: "Звуковые эффекты" },
  On: { en: "On", ru: "Вкл." },
  Off: { en: "Off", ru: "Выкл." },
  Done: { en: "Done", ru: "Готово" },
  Close: { en: "Close", ru: "Закрыть" },
  "The server is at capacity right now — please try again in a moment.": { en: "The server is at capacity right now — please try again in a moment.", ru: "Сервер сейчас перегружен — попробуйте ещё раз чуть позже." },
  "That game doesn't exist.": { en: "That game doesn't exist.", ru: "Такой игры не существует." },
  "This game is already in progress — you can't join right now.": { en: "This game is already in progress — you can't join right now.", ru: "Игра уже началась — сейчас присоединиться нельзя." },
  "That name is taken. Try another.": { en: "That name is taken. Try another.", ru: "Это имя уже занято. Попробуйте другое." },
  "That avatar was just taken. Pick another.": { en: "That avatar was just taken. Pick another.", ru: "Этот аватар уже выбрали. Выберите другой." },
  "This game is full.": { en: "This game is full.", ru: "В игре уже максимальное количество игроков." },
  "e.g. abr-tyr": { en: "e.g. abr-tyr", ru: "например, abr-tyr" },
  "Game lobby": { en: "Game lobby", ru: "Игровое лобби" },
  "Solo mode": { en: "Solo mode", ru: "Одиночная игра" },
  Multiplayer: { en: "Multiplayer", ru: "Мультиплеер" },
  "Show QR code": { en: "Show QR code", ru: "Показать QR-код" },
  "Copied!": { en: "Copied!", ru: "Скопировано!" },
  "Copy link": { en: "Copy link", ru: "Скопировать ссылку" },
  "Players": { en: "Players", ru: "Игроки" },
  "participants": { en: "participants", ru: "участников" },
  "Match settings ⚙️": { en: "Match settings ⚙️", ru: "Настройки матча ⚙️" },
  "Host only": { en: "Host only", ru: "Только хост" },
  "Number of rounds": { en: "Number of rounds", ru: "Количество раундов" },
  "Hide-and-seek cycles per game": { en: "Hide-and-seek cycles per game", ru: "Циклов пряток за игру" },
  rounds: { en: "rounds", ru: "раундов" },
  "Hiding timer": { en: "Hiding timer", ru: "Таймер на прятки" },
  "Time to choose a spot": { en: "Time to choose a spot", ru: "Время на выбор места" },
  "Finding timer": { en: "Finding timer", ru: "Таймер на поиск" },
  "Time to make a guess": { en: "Time to make a guess", ru: "Время на поиск места" },
  "Allow unofficial coverage": { en: "Allow unofficial coverage", ru: "Разрешить неофициальные панорамы" },
  "Buildings and unofficial photospheres for hiding spots": { en: "Buildings and unofficial photospheres for hiding spots", ru: "Интерьеры и неофициальные фотосферы для схованок" },
  Enabled: { en: "Enabled", ru: "Включено" },
  Disabled: { en: "Disabled", ru: "Выключено" },
  "Official only": { en: "Official only", ru: "Только официальные" },
  "Official and unofficial": { en: "Official + unofficial", ru: "Официальные + неофициальные" },
  "Play solo": { en: "Play solo", ru: "Играть одному" },
  "Start game": { en: "Start game", ru: "Начать игру" },
  "You're alone in the room. Guess locations picked by the server. Invite a friend to compete!": { en: "You're alone in the room. Guess locations picked by the server. Invite a friend to compete!", ru: "Вы пока одни. Угадывайте места, выбранные сервером. Пригласите друга для соревнования!" },
  "Waiting for the host to start the game…": { en: "Waiting for the host to start the game…", ru: "Ожидание начала игры от ведущего…" },
  "Close dialog": { en: "Close dialog", ru: "Закрыть окно" },
  "Scan to join": { en: "Scan to join", ru: "Отсканируйте для входа" },
  "No limit": { en: "No limit", ru: "Без ограничений" },
  " min ": { en: " min ", ru: " мин " },
  " min": { en: " min", ru: " мин" },
  " sec": { en: " sec", ru: " сек" },
  "You're hidden 🫣": { en: "You're hidden 🫣", ru: "Вы спрятались 🫣" },
  "Waiting for everyone to pick a hiding spot.": { en: "Waiting for everyone to pick a hiding spot.", ru: "Ждём, пока все выберут место для укрытия." },
  "Players hidden": { en: "Players hidden", ru: "Игроки спрятались" },
  ready: { en: "ready", ru: "готов" },
  hidden: { en: "hidden", ru: "спрятался" },
  offline: { en: "offline", ru: "не в сети" },
  host: { en: "host", ru: "ведущий" },
  "Hiding spots": { en: "Hiding spots", ru: "Места укрытия" },
  "still picking": { en: "still picking", ru: "выбирает место" },
  "picking…": { en: "picking…", ru: "выбирает…" },
  "off": { en: "off", ru: "нет связи" },
  "Pick your hiding spot": { en: "Pick your hiding spot", ru: "Выберите место укрытия" },
  "Choose a spot on the map to load Street View.": { en: "Choose a spot on the map to load Street View.", ru: "Выберите место на карте, чтобы загрузить Street View." },
  "Choose your hiding spot": { en: "Choose your hiding spot", ru: "Выберите место укрытия" },
  "First, choose a spot on the map": { en: "First, choose a spot on the map", ru: "Сначала выберите место на карте" },
  "Loading panorama…": { en: "Loading panorama…", ru: "Загрузка панорамы…" },
  "No Street View found nearby.": { en: "No Street View found nearby.", ru: "Поблизости не найден Street View." },
  "Hide in this panorama?": { en: "Hide in this panorama?", ru: "Спрятаться в этой панораме?" },
  "Hide here": { en: "Hide here", ru: "Спрятаться здесь" },
  "Where in the world is this?": { en: "Where in the world is this?", ru: "Где это место?" },
  "Where is": { en: "Where is", ru: "Где спрятался" },
  "hiding?": { en: "hiding?", ru: "?" },
  "drop your guess": { en: "drop your guess", ru: "отметьте догадку на карте" },
  "Move the map and place your guess": { en: "Move the map and place your guess", ru: "Передвиньте карту и отметьте место" },
  "Click the map to place your guess.": { en: "Click the map to place your guess.", ru: "Нажмите на карту, чтобы отметить место." },
  "Lock it in?": { en: "Lock it in?", ru: "Подтвердить догадку?" },
  "Guess here": { en: "Guess here", ru: "Подтвердить" },
  "Everyone's hunting for you 🔎": { en: "Everyone's hunting for you 🔎", ru: "Все ищут вас 🔎" },
  "Sit tight while the others guess your hiding spot.": { en: "Sit tight while the others guess your hiding spot.", ru: "Оставайтесь на месте, пока остальные ищут вас." },
  "Guess locked in ✅": { en: "Guess locked in ✅", ru: "Догадка принята ✅" },
  "Waiting for the other hunters to lock in.": { en: "Waiting for the other hunters to lock in.", ru: "Ждём догадки остальных игроков." },
  "Guesses in": { en: "Guesses in", ru: "Догадки" },
  "Choose a hunter": { en: "Choose a hunter", ru: "Выберите игрока" },
  "live hunter view": { en: "live hunter view", ru: "экран игрока в реальном времени" },
  "Loading hunter's Street View…": { en: "Loading hunter's Street View…", ru: "Загрузка Street View игрока…" },
  "Hunters' guesses": { en: "Hunters' guesses", ru: "Догадки игроков" },
  "Tallying the round…": { en: "Tallying the round…", ru: "Подсчитываем результаты…" },
  "The real spot": { en: "The real spot", ru: "Настоящее место" },
  "This was the spot 📍": { en: "This was the spot 📍", ru: "Это было настоящее место 📍" },
  " was hiding here 📍": { en: " was hiding here 📍", ru: " спрятался здесь 📍" },
  "Round": { en: "Round", ru: "Раунд" },
  "of": { en: "of", ru: "из" },
  "This round's guesses": { en: "This round's guesses", ru: "Догадки этого раунда" },
  Standings: { en: "Standings", ru: "Таблица результатов" },
  you: { en: "you", ru: "вы" },
  "See final scores": { en: "See final scores", ru: "Итоговые результаты" },
  "Next round": { en: "Next round", ru: "Следующий раунд" },
  "Waiting for the host to continue…": { en: "Waiting for the host to continue…", ru: "Ждём, пока ведущий продолжит…" },
  "Game over": { en: "Game over", ru: "Игра окончена" },
  "Back to lobby": { en: "Back to lobby", ru: "Вернуться в лобби" },
  "Waiting for the host to return to the lobby…": { en: "Waiting for the host to return to the lobby…", ru: "Ждём, пока ведущий вернётся в лобби…" },
  "Close game": { en: "Close game", ru: "Закрыть игру" },
  "Exit game": { en: "Exit game", ru: "Выйти из игры" },
  "Close game?": { en: "Close game?", ru: "Закрыть игру?" },
  "Exit game?": { en: "Exit game?", ru: "Выйти из игры?" },
  "This ends the game for everyone and sends all players back to the home page.": { en: "This ends the game for everyone and sends all players back to the home page.", ru: "Игра завершится для всех, и все вернутся на главную страницу." },
  "You'll go back to the home page. The other players keep playing.": { en: "You'll go back to the home page. The other players keep playing.", ru: "Вы вернётесь на главную, остальные продолжат играть." },
  Cancel: { en: "Cancel", ru: "Отмена" },
  "Close game for everyone": { en: "Close game for everyone", ru: "Завершить игру для всех" },
  Menu: { en: "Menu", ru: "Меню" },
  "Hold to talk": { en: "Hold to talk", ru: "Удерживайте, чтобы говорить" },
  "Voice settings": { en: "Voice settings", ru: "Настройки голоса" },
  "Join the game": { en: "Join the game", ru: "Вход в игру" },
  "Your name label": { en: "Your name", ru: "Ваше имя" },
  "Enter your name...": { en: "Enter your name...", ru: "Введите имя..." },
  "Choose avatar": { en: "Choose avatar", ru: "Выберите аватар" },
  "Join": { en: "Join", ru: "Присоединиться" },
  "Round started!": { en: "Round started!", ru: "Раунд начался!" },
  "Created by": { en: "Created by", ru: "Создатель" },
  "source code on GitHub": { en: "source code on GitHub", ru: "исходный код на GitHub" },
  "Back on": { en: "Back on", ru: "Снова доступно" },
  "Out of map budget 🌍": { en: "Monthly usage allowance reached 🌍", ru: "Месячный лимит использования исчерпан 🌍" },
  "This game can't start — the month's Google Maps budget just ran out.": { en: "This game can't start — this server's monthly usage allowance has been reached.", ru: "Игра не может начаться — месячный лимит этого сервера исчерпан." },
  "World Seek has used up this month's Google Maps budget.": { en: "This server has reached its monthly Google Maps usage allowance.", ru: "Этот сервер достиг месячного лимита использования Google Maps." },
  "The server uses an estimated monthly Google Maps usage allowance. This is separate from your actual Google Cloud bill. The allowance resets on the 1st.": { en: "The server uses an estimated monthly Google Maps usage allowance. This is separate from your actual Google Cloud bill. The allowance resets on the 1st.", ru: "Сервер использует расчетный месячный лимит Google Maps. Он не отражает фактический счет Google Cloud. Лимит обновляется первого числа." },
  "World Seek is open source. Run your own copy with your own Google Maps key and there's no cap but the one you set.": { en: "World Seek is open source. Run your own copy with your own Google Maps key and there's no cap but the one you set.", ru: "World Seek — проект с открытым исходным кодом. Запустите собственную версию со своим ключом Google Maps и задайте свой лимит." },
  "Made by": { en: "Made by", ru: "Автор" },
  "Background music": { en: "Background music", ru: "Фоновая музыка" },
  "Background music volume": { en: "Background music volume", ru: "Громкость фоновой музыки" },
  "Add your MP3 at public/music/background.mp3 (3–10 MB recommended).": { en: "Add your MP3 at public/music/background.mp3 (3–10 MB recommended).", ru: "Добавьте MP3 в public/music/background.mp3 (рекомендуется 3–10 МБ)." },
  "started!": { en: "started!", ru: "начался!" },
  "real hiding spot": { en: "real hiding spot", ru: "настоящее место укрытия" },
  "Back": { en: "Back", ru: "Назад" },
  "Back to start": { en: "Back to start", ru: "К началу" },
  "Choose hiding spot on map": { en: "Choose hiding spot on map", ru: "Выберите место укрытия на карте" },
  "Pick a location on the map to load Street View.": { en: "Pick a location on the map to load Street View.", ru: "Выберите место на карте, чтобы загрузить Street View." },
  "Hiding status": { en: "Hiding status", ru: "Статус укрытий" },
  "Continue along the road": { en: "Continue along the road", ru: "Продолжить движение по дороге" },
  "Choose your avatar": { en: "Choose your avatar", ru: "Выберите аватар" },
  "Connecting…": { en: "Connecting…", ru: "Подключение…" },
  "Reconnecting…": { en: "Reconnecting…", ru: "Повторное подключение…" },
  "Chat": { en: "Chat", ru: "Чат" },
  "Close chat": { en: "Close chat", ru: "Закрыть чат" },
  "No messages yet.": { en: "No messages yet.", ru: "Сообщений пока нет." },
  "Message…": { en: "Message…", ru: "Сообщение…" },
  "Send": { en: "Send", ru: "Отправить" },
  "Sound effects volume": { en: "Sound effects volume", ru: "Громкость эффектов" },
  "Voice Settings": { en: "Voice Settings", ru: "Настройки голоса" },
  "Microphone": { en: "Microphone", ru: "Микрофон" },
  "Loading…": { en: "Loading…", ru: "Загрузка…" },
  "No microphones found.": { en: "No microphones found.", ru: "Микрофоны не найдены." },
  "Mic level": { en: "Mic level", ru: "Уровень микрофона" },
  "Mic unavailable": { en: "Mic unavailable", ru: "Микрофон недоступен" },
  "Requesting mic access…": { en: "Requesting mic access…", ru: "Запрашиваем доступ к микрофону…" },
  "Voice mode": { en: "Voice mode", ru: "Режим голосового чата" },
  "Always on": { en: "Always on", ru: "Всегда включён" },
  "Mic is always transmitting": { en: "Mic is always transmitting", ru: "Микрофон всегда передаёт звук" },
  "Push to talk": { en: "Push to talk", ru: "Нажми и говори" },
  "Hold Space (or button) to speak": { en: "Hold Space (or button) to speak", ru: "Удерживайте пробел (или кнопку), чтобы говорить" },
  "Mute": { en: "Mute", ru: "Без звука" },
  "No audio transmitted": { en: "No audio transmitted", ru: "Звук не передаётся" },
  "Couldn't find a spot 😕": { en: "Couldn't find a spot 😕", ru: "Не удалось найти место 😕" },
  "Street View didn't answer. Give it another try.": { en: "Street View didn't answer. Give it another try.", ru: "Street View не ответил. Попробуйте ещё раз." },
  "Try again": { en: "Try again", ru: "Попробовать снова" },
  "Finding a location… 🌍": { en: "Finding a location… 🌍", ru: "Ищем место… 🌍" },
  "Dropping you somewhere in the world.": { en: "Dropping you somewhere in the world.", ru: "Ищем случайное место в мире." },
  "What happened": { en: "What happened", ru: "Что произошло" },
  "Play it anyway 🛠️": { en: "Play it anyway 🛠️", ru: "Запустите свою версию 🛠️" },
  "Get the source code": { en: "Get the source code", ru: "Получить исходный код" },
  "English": { en: "English", ru: "Английский" },
  "Russian": { en: "Russian", ru: "Русский" },
};

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (text: string) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: "en",
  setLanguage: () => {},
  t: (text) => translations[text]?.en ?? text,
});

export function LanguageProvider(props: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");

  useEffect(() => {
    const stored = window.localStorage.getItem("world-seek-language");
    if (stored === "en" || stored === "ru") setLanguageState(stored);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  function setLanguage(next: Language) {
    window.localStorage.setItem("world-seek-language", next);
    setLanguageState(next);
  }

  function t(text: string) {
    return translations[text]?.[language] ?? text;
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {props.children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}

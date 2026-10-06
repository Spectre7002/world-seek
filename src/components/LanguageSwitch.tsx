"use client";

import { useLanguage } from "@/lib/language";

export default function LanguageSwitch() {
  const { language, setLanguage } = useLanguage();
  return (
    <div className="language-switch" role="group" aria-label={language === "ru" ? "Язык интерфейса" : "Interface language"}>
      <button
        type="button"
        className={language === "en" ? "is-active" : ""}
        onClick={() => setLanguage("en")}
        aria-pressed={language === "en"}
      >
        EN
      </button>
      <button
        type="button"
        className={language === "ru" ? "is-active" : ""}
        onClick={() => setLanguage("ru")}
        aria-pressed={language === "ru"}
      >
        RU
      </button>
    </div>
  );
}

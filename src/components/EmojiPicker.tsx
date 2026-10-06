"use client";

import { useEffect } from "react";
import { EMOJIS, emojiUrl } from "@/shared/emojis";
import { useLanguage } from "@/lib/language";

interface Props {
  value: string;
  onChange: (id: string) => void;
  taken?: string[];
}

export default function EmojiPicker(props: Props) {
  const { t } = useLanguage();
  const value = props.value;
  const onChange = props.onChange;
  const taken = props.taken;

  const takenSet = new Set(taken || []);

  useEffect(
    function () {
      const available = [];
      for (let i = 0; i < EMOJIS.length; i++) {
        if (!takenSet.has(EMOJIS[i].id)) {
          available.push(EMOJIS[i]);
        }
      }

      if ((!value || takenSet.has(value)) && available.length > 0) {
        onChange(available[0].id);
      }
    },
    [value, taken]
  );

  return (
    <div className="emoji-grid" role="radiogroup" aria-label={t("Choose your avatar")}>
      {EMOJIS.map(function (e) {
        const selected = e.id === value;
        const disabled = takenSet.has(e.id) && !selected;

        function handleClick() {
          if (!disabled) {
            onChange(e.id);
          }
        }

        return (
          <button
            type="button"
            key={e.id}
            role="radio"
            aria-checked={selected}
            aria-label={e.id}
            className={`emoji-cell${selected ? " is-selected" : ""}`}
            disabled={disabled}
            onClick={handleClick}
          >
            <img
              className="emoji-img"
              src={emojiUrl(e.id)}
              alt=""
              draggable={false}
            />
          </button>
        );
      })}
    </div>
  );
}
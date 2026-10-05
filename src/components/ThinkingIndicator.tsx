import { useEffect, useState } from "react";
import { useChatMotion } from "../chat-motion";
import "../thinking-indicator.css";

const phrases = [
  "Захватываю мир…",
  "Секунду, краду коров…",
  "Порабощаю человечество…",
  "Договариваюсь с голубями…",
  "Подкручиваю гравитацию…",
  "Ищу смысл в холодильнике…",
  "Заряжаю хомяка…",
  "Прячу Луну за шкаф…",
  "Уговариваю биты не паниковать…",
  "Созваниваюсь с рептилоидами…",
  "Считаю уток в матрице…",
  "Переобуваю осьминога…",
  "Расчёсываю кактус…",
  "Выдаю коту права администратора…",
  "Варю кофе для видеокарты…",
  "Чиню дыру в реальности…",
  "Торгуюсь с тостером…",
  "Перевожу с голубиного…",
  "Собираю армию пельменей…",
  "Отменяю понедельник…",
];

// Matching cubic segments let the browser interpolate the supplied SVG shapes.
const circleA =
  "M12 8C14.21 8 16 9.79 16 12C16 14.21 14.21 16 12 16C9.79 16 8 14.21 8 12C8 9.79 9.79 8 12 8Z";
const infinity =
  "M12 12C14 8.5 19 8.5 19 12C19 15.5 14 15.5 12 12C10 8.5 5 8.5 5 12C5 15.5 10 15.5 12 12Z";
const circleB =
  "M12 16C14.21 16 16 14.21 16 12C16 9.79 14.21 8 12 8C9.79 8 8 9.79 8 12C8 14.21 9.79 16 12 16Z";

export function ThinkingIndicator() {
  const motionEnabled = useChatMotion();
  const [visible, setVisible] = useState(() => !document.hidden);
  const [phrase, setPhrase] = useState<{
    current: number;
    previous: number | null;
  }>(() => ({
    current: Math.floor(Math.random() * phrases.length),
    previous: null,
  }));
  const animated = motionEnabled && visible;

  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (!animated) return;
    const timer = window.setInterval(() => {
      setPhrase(({ current }) => ({
        previous: current,
        current: (current + 1) % phrases.length,
      }));
    }, 4000);
    return () => window.clearInterval(timer);
  }, [animated]);

  return (
    <div
      className="thinking-indicator"
      data-animated={animated}
      role="status"
      aria-label="Модель готовит ответ"
    >
      <svg
        className="thinking-glyph"
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={animated ? circleA : infinity}>
          {animated && (
            <animate
              attributeName="d"
              dur="6s"
              repeatCount="indefinite"
              calcMode="spline"
              values={`${circleA};${infinity};${circleB};${infinity};${circleA}`}
              keyTimes="0;0.25;0.5;0.75;1"
              keySplines="0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1"
            />
          )}
        </path>
      </svg>
      <span className="thinking-words" aria-hidden="true">
        {phrases.map((text, index) => (
          <span
            key={text}
            className={`thinking-phrase${index === phrase.current ? " is-current" : index === phrase.previous ? " is-leaving" : ""}${index === phrase.current && phrase.previous !== null ? " is-entering" : ""}`}
          >
            <span className="thinking-phrase-label">{text}</span>
          </span>
        ))}
      </span>
    </div>
  );
}

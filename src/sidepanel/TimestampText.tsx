import { parseTimestamp } from "../shared/timestamps";
export function TimestampText({
  text,
  onSeek,
}: {
  text: string;
  onSeek: (seconds: number) => void;
}) {
  return (
    <div className="result">
      {text.split(/(\[\d{1,3}:\d{2}(?::\d{2})?\])/g).map((part, index) => {
        const seconds = part.startsWith("[") ? parseTimestamp(part) : null;
        return seconds === null ? (
          part
        ) : (
          <button
            className="timestamp"
            key={index}
            onClick={() => onSeek(seconds)}
            aria-label={`Saltar a ${part}`}
          >
            {part}
          </button>
        );
      })}
    </div>
  );
}

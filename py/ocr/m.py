
import subprocess
import sys
from pathlib import Path

try:
    import yt_dlp
except ImportError:
    print("Installa yt-dlp con: py -m pip install -U yt-dlp")
    sys.exit(1)


def to_seconds(value: str) -> int:
    """Converte SS, MM:SS oppure HH:MM:SS in secondi."""
    parts = [int(p) for p in value.strip().split(":")]

    if not 1 <= len(parts) <= 3 or any(p < 0 for p in parts):
        raise ValueError("Formato tempo non valido")

    if len(parts) == 1:
        return parts[0]
    if len(parts) == 2:
        if parts[1] >= 60:
            raise ValueError("I secondi devono essere inferiori a 60")
        return parts[0] * 60 + parts[1]

    if parts[1] >= 60 or parts[2] >= 60:
        raise ValueError("Minuti e secondi devono essere inferiori a 60")

    return parts[0] * 3600 + parts[1] * 60 + parts[2]


def main():
    url = input("URL YouTube: ").strip()
    start_text = input("Inizio (es. 01:20): ").strip()
    end_text = input("Fine (es. 02:45): ").strip()
    output = input("Nome file MP4 [frammento.mp4]: ").strip()

    if not output:
        output = "frammento.mp4"
    if not output.lower().endswith(".mp4"):
        output += ".mp4"

    start = to_seconds(start_text)
    end = to_seconds(end_text)

    if end <= start:
        raise ValueError("Il tempo finale deve essere successivo all'inizio.")

    if not url.startswith(("https://", "http://")):
        raise ValueError("Inserisci un URL HTTP/HTTPS valido.")

    if not shutil_which("ffmpeg"):
        raise RuntimeError(
            "FFmpeg non trovato. Installalo e riapri il terminale."
        )

    output_path = Path(output).resolve()
    section = f"*{start}-{end}"

    options = {
        "format": "bestvideo+bestaudio/best",
        "download_sections": [section],
        "force_keyframes_at_cuts": True,
        "merge_output_format": "mp4",
        "outtmpl": str(output_path.with_suffix(".%(ext)s")),
        "noplaylist": True,
    }

    with yt_dlp.YoutubeDL(options) as ydl:
        ydl.download([url])

    print(f"\nOperazione completata: {output_path}")


def shutil_which(command):
    import shutil
    return shutil.which(command)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError) as exc:
        print(f"\nErrore: {exc}")
    except KeyboardInterrupt:
        print("\nOperazione annullata.")

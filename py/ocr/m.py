
import shutil
import sys
from pathlib import Path

try:
    import yt_dlp
except ImportError:
    print("Installa yt-dlp con: py -m pip install -U yt-dlp")
    sys.exit(1)


def to_seconds(value: str) -> int:
    """Converte SS, MM:SS oppure HH:MM:SS in secondi."""
    parts = value.strip().split(":")

    if not 1 <= len(parts) <= 3:
        raise ValueError("Formato tempo non valido.")

    if not all(p.isdigit() for p in parts):
        raise ValueError("Formato non valido. Esempio: 01:20 oppure 00:01:20.")

    nums = [int(p) for p in parts]

    if len(nums) >= 2 and nums[-1] >= 60:
        raise ValueError("I secondi devono essere inferiori a 60.")

    if len(nums) == 3 and nums[1] >= 60:
        raise ValueError("I minuti devono essere inferiori a 60.")

    if len(nums) == 1:
        return nums[0]
    if len(nums) == 2:
        return nums[0] * 60 + nums[1]

    return nums[0] * 3600 + nums[1] * 60 + nums[2]


def main():
    if not shutil.which("ffmpeg"):
        raise RuntimeError(
            "FFmpeg non trovato. Installalo e aggiungilo al PATH."
        )

    url = input("URL YouTube: ").strip()
    start = to_seconds(input("Inizio (es. 01:20): "))
    end = to_seconds(input("Fine (es. 02:45): "))

    if not url.startswith(("https://", "http://")):
        raise ValueError("Inserisci un URL HTTP/HTTPS valido.")

    if end <= start:
        raise ValueError("La fine deve essere successiva all'inizio.")

    output_text = input(
        "Nome file MP4 [frammento.mp4]: "
    ).strip().strip('"')

    if not output_text:
        output_text = "frammento.mp4"

    output = Path(output_text).expanduser().resolve()

    if output.suffix.lower() != ".mp4":
        output = output.with_suffix(".mp4")

    output.parent.mkdir(parents=True, exist_ok=True)

    # L'asterisco indica un intervallo temporale in secondi.
    section = f"*{start}-{end}"

    options = {
        # Preferisce video MP4 e audio M4A, se disponibili.
        "format": (
            "bv*[ext=mp4]+ba[ext=m4a]/"
            "b[ext=mp4]/bv*+ba/b"
        ),

        # Richiede soltanto la sezione indicata.
        "download_sections": [section],

        # Migliora la precisione dei tagli ricodificando il segmento.
        "force_keyframes_at_cuts": True,

        "merge_output_format": "mp4",
        "outtmpl": str(output.with_suffix("")) + ".%(ext)s",
        "noplaylist": True,
        "overwrites": True,
        "continuedl": False,
        "nopart": True,
        "progress": True,
    }

    print(f"\nURL: {url}")
    print(f"Intervallo richiesto: {start}s - {end}s")
    print(f"Durata finale attesa: {end - start}s")
    print("Download della sezione in corso...\n")

    with yt_dlp.YoutubeDL(options) as ydl:
        ydl.download([url])

    if not output.is_file() or output.stat().st_size == 0:
        raise RuntimeError(
            "Il file MP4 atteso non è stato creato. "
            "Controlla i messaggi di yt-dlp."
        )

    print(f"\nCompletato: {output}")
    print(f"Dimensione: {output.stat().st_size / (1024**2):.2f} MB")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, yt_dlp.utils.DownloadError) as exc:
        print(f"\nErrore: {exc}")
    except KeyboardInterrupt:
        print("\nOperazione annullata.")


import subprocess
import shutil
from pathlib import Path


def to_seconds(value: str) -> float:
    """Accetta secondi, MM:SS oppure HH:MM:SS."""
    parts = value.strip().split(":")

    if not 1 <= len(parts) <= 3:
        raise ValueError("Formato tempo non valido.")

    try:
        nums = [float(p) for p in parts]
    except ValueError:
        raise ValueError("Inserisci un tempo valido.")

    if any(n < 0 for n in nums):
        raise ValueError("Il tempo non può essere negativo.")

    if len(nums) == 1:
        return nums[0]
    if len(nums) == 2:
        if nums[1] >= 60:
            raise ValueError("I secondi devono essere inferiori a 60.")
        return nums[0] * 60 + nums[1]

    if nums[1] >= 60 or nums[2] >= 60:
        raise ValueError("Minuti e secondi devono essere inferiori a 60.")

    return nums[0] * 3600 + nums[1] * 60 + nums[2]


def main():
    if not shutil.which("ffmpeg"):
        raise RuntimeError(
            "FFmpeg non trovato. Installalo con: winget install Gyan.FFmpeg"
        )

    video = Path(input("Percorso del video locale: ").strip().strip('"'))

    if not video.is_file():
        raise FileNotFoundError(f"File non trovato: {video}")

    start = to_seconds(input("Inizio (es. 01:20 oppure 00:01:20): "))
    end = to_seconds(input("Fine (es. 02:45 oppure 00:02:45): "))

    if end <= start:
        raise ValueError("La fine deve essere successiva all'inizio.")

    output_text = input(
        "Nome file di uscita [frammento.mp4]: "
    ).strip()

    output = Path(output_text or "frammento.mp4")

    if not output.is_absolute():
        output = video.parent / output

    if output.suffix.lower() != ".mp4":
        output = output.with_suffix(".mp4")

    if output.resolve() == video.resolve():
        raise ValueError("Il file di uscita non può sovrascrivere l'originale.")

    duration = end - start

    command = [
        "ffmpeg",
        "-hide_banner",
        "-y",
        "-ss", str(start),
        "-i", str(video),
        "-t", str(duration),
        "-map", "0:v:0",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "18",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        str(output),
    ]

    print(f"\nEstrazione da {start} a {end} secondi...")
    subprocess.run(command, check=True)

    print(f"\nCompletato: {output.resolve()}")
    print(f"Durata richiesta: {duration:.2f} secondi")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, FileNotFoundError, RuntimeError,
            subprocess.CalledProcessError) as exc:
        print(f"\nErrore: {exc}")

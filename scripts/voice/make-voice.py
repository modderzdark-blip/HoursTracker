"""Makes the announcer's voice clips (www/audio/voice/*.ogg) with the open Kokoro-82M text-to-speech model (Apache-2.0).

Developer tool, run by hand (never in CI): needs `pip install kokoro-onnx soundfile` and the model files
kokoro-v1.0.int8.onnx and voices-v1.0.bin from https://github.com/thewh1teagle/kokoro-onnx/releases (model-files-v1.0),
plus ffmpeg with libopus.

Usage: python3 scripts/voice/make-voice.py <model dir> <output dir>
"""
import os
import re
import subprocess
import sys
import tempfile

import soundfile as sf
from kokoro_onnx import Kokoro

# Our own praise words (never the original's), the finale call, and how each one is spoken.
CLIPS = {
    'sweet': 'Sweet!',
    'yummy': 'Yummy!',
    'scrumptious': 'Scrumptious!',
    'sensational': 'Sensational!',
    'sugarstorm': 'Sugar Storm!',
    'finale': 'Sweet Finale!',
}
VOICE = 'am_michael'
SPEED = 0.9
# A warm announcer: two semitones lower, a little compression and a short, bright room.
PITCH = 2 ** (-2 / 12)


def peak_db(path):
    probe = subprocess.run(['ffmpeg', '-hide_banner', '-i', path, '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True)
    match = re.search(r'max_volume: (-?[\d.]+) dB', probe.stderr)
    return float(match.group(1)) if match else 0.0


def main():
    model_dir, out_dir = sys.argv[1], sys.argv[2]
    kokoro = Kokoro(os.path.join(model_dir, 'kokoro-v1.0.int8.onnx'), os.path.join(model_dir, 'voices-v1.0.bin'))
    os.makedirs(out_dir, exist_ok=True)
    with tempfile.TemporaryDirectory() as work:
        for name, text in CLIPS.items():
            samples, rate = kokoro.create(text, voice=VOICE, speed=SPEED, lang='en-us')
            raw = os.path.join(work, f'{name}.wav')
            shaped = os.path.join(work, f'{name}-shaped.wav')
            sf.write(raw, samples, rate)
            chain = ','.join([
                f'asetrate={rate}*{PITCH:.5f}', 'aresample=48000', f'atempo={1 / PITCH:.5f}',
                'silenceremove=start_periods=1:start_threshold=-48dB',
                'highpass=f=80', 'acompressor=threshold=-20dB:ratio=3:attack=4:release=60',
                'aecho=0.8:0.5:32|64:0.16|0.08',
            ])
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-af', chain, '-ac', '1', shaped], check=True)
            gain = -3.0 - peak_db(shaped)
            target = os.path.join(out_dir, f'{name}.ogg')
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', shaped, '-af', f'volume={gain:.2f}dB',
                            '-ac', '1', '-c:a', 'libopus', '-b:a', '48k', target], check=True)
            print(f'{target}: {os.path.getsize(target)} bytes')


if __name__ == '__main__':
    main()

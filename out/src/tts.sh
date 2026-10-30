#!/bin/bash
# Generates one MP3 per narration section via ElevenLabs. Usage: ELEVEN_KEY=... ./tts.sh
cd "$(dirname "$0")"
VOICE=${VOICE:-JBFqnCBsd6RMkjVDRZzb}   # "George" - warm British English
python3 -c "import json;[print(s['id']+'\t'+s['text']) for s in json.load(open('script.json'))]" | while IFS=$'\t' read -r id text; do
  [ -s "vo/$id.mp3" ] && continue
  python3 - "$text" > /tmp/body.json <<'PY'
import json,sys;print(json.dumps({"text":sys.argv[1],"model_id":"eleven_multilingual_v2","voice_settings":{"stability":0.45,"similarity_boost":0.8,"style":0.35,"use_speaker_boost":True}}))
PY
  curl -sS -o "vo/$id.mp3" -w "$id %{http_code}\n" -X POST "https://api.elevenlabs.io/v1/text-to-speech/$VOICE?output_format=mp3_44100_128" \
    -H "xi-api-key: $ELEVEN_KEY" -H "Content-Type: application/json" -d @/tmp/body.json
done
for f in vo/*.mp3; do printf "%s " "$f"; ffprobe -v error -show_entries format=duration -of csv=p=0 "$f"; done

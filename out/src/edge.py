import asyncio, json, os, certifi
certifi.where = lambda: os.path.abspath("ca.pem")
import edge_tts
VOICE = os.environ.get("VOICE", "en-GB-RyanNeural")
async def main():
    for s in json.load(open("script.json")):
        out = f"vo/{s['id']}.mp3"
        if os.path.exists(out) and os.path.getsize(out) > 1000: continue
        await edge_tts.Communicate(s["text"], VOICE, rate="+4%", proxy=os.environ.get("HTTPS_PROXY")).save(out)
        print("ok", out)
asyncio.run(main())

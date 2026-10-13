# 🪝 HookLab (local edition)

Break down why a TikTok or Instagram Reel went viral: the 3-second hook, the open loops, pacing, and what makes people share it. Then turn it into hooks for your own videos.

HookLab runs **entirely on your computer** with **your own AI API keys**. There is no account, no server and no tracking. Your keys stay in a `.env` file on your machine and are sent only to the provider they belong to.

## What it does

Paste a TikTok or Instagram link (or attach a video file) and HookLab:

1. downloads the video and its stats (views, likes, shares, caption, sound) with [yt-dlp](https://github.com/yt-dlp/yt-dlp);
2. pulls 13 frames, densest in the first 3 seconds, and detects every hard cut with ffmpeg;
3. **transcribes the speech with timestamps**, so it knows exactly what is said in the hook window;
4. sends all of that to the AI model you choose (Claude, GPT, Gemini, or anything OpenAI-compatible, including local models via Ollama) for a structured breakdown. Then you can keep chatting about it.

## Get started

**1. Install Node.js** (free): download the **LTS** version from [nodejs.org](https://nodejs.org/en/download) and run the installer. You only do this once.

**2. Download HookLab**: on this page, click the green **Code** button, then **Download ZIP**. Unzip it wherever you like.

**3. Start it**: open the HookLab folder and double-click:

| macOS | Windows |
| --- | --- |
| **Start HookLab.command** | **Start HookLab.bat** |

The first start installs everything it needs, which takes a minute or two. After that, HookLab opens in your browser and asks which AI to use. Pick one, paste a key (or choose the free local option) and you're done. Nothing to edit by hand.

Keep the small terminal window open while you use HookLab, and close it to quit. To come back later, double-click the same file again.

> **macOS says the file "can't be opened" or is from an unidentified developer?** That happens the first time with anything downloaded from the internet. Open **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to "Start HookLab.command". You only need to do this once.

<details>
<summary>Prefer the terminal?</summary>

```bash
git clone https://github.com/Alexander-Infante/social-media-hook-tool-local.git hooklab && cd hooklab
npm install
npm start          # opens http://localhost:8787
```

`npm run doctor` checks your setup and tells you what's missing.
</details>

## Choosing an AI model

The setup screen offers these. You can add more, test them or switch the default any time under **Settings**:

| Option | Cost | Get a key |
| --- | --- | --- |
| **Claude** (recommended) | pay per use | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| **OpenAI** | pay per use | [platform.openai.com](https://platform.openai.com/api-keys) |
| **Gemini** | free tier available | [aistudio.google.com](https://aistudio.google.com/apikey) |
| **Free & private** (Ollama) | free | no key needed |
| **Other**: OpenRouter, Groq, xAI, LM Studio… | varies | your provider |

HookLab checks each key with a tiny request before saving it. Usage is billed by each provider to your own account, so set a spending limit there.

### Free, private AI on your computer (Ollama)

1. Pick **Free & private** on the setup screen.
2. Click **Download Ollama**, install it and open it. HookLab notices automatically.
3. Click **Download gemma3:4b** (3.3 GB). HookLab connects it as soon as the download finishes.

Local models work best on a computer with 16 GB of memory. They're slower and less sharp than Claude or OpenAI, but nothing leaves your machine. To use a different model, pick one tagged "vision" at [ollama.com](https://ollama.com/search?c=vision) so it can see the video frames.

### Where settings are saved

Everything you set up in the app is saved in `data/settings.json` inside the HookLab folder. It's a plain JSON file, it's gitignored, and only your user account can read it. Delete it to start setup over.

Power users can also use a `.env` file (copy `.env.example` to see every option, such as model lists, the port and Whisper settings). Values saved in the app take priority over `.env`.

## Links (yt-dlp)

HookLab uses [yt-dlp](https://github.com/yt-dlp/yt-dlp) to download TikTok and Instagram links. If it isn't already installed, HookLab downloads the official build into `bin/` the first time it starts, checks it against yt-dlp's published checksums, and keeps it up to date. If you already have yt-dlp (for example from Homebrew), HookLab uses yours.

TikTok and Instagram change their sites often. If links stop working, restart HookLab to pick up the latest yt-dlp. Instagram frequently blocks downloads; save the reel and attach the file instead.

## Transcription

The transcript is the most important input for hook analysis, so HookLab tries these in order and uses the first that finds speech (`TRANSCRIPTION=auto`):

| | Needs | Cost | Notes |
| --- | --- | --- | --- |
| **OpenAI Whisper** | an OpenAI key | ~$0.006 / minute | Word-level timestamps |
| **Groq Whisper** (large-v3-turbo) | a Groq key (add it under **Settings → Transcription**) | very cheap, free tier | Word-level timestamps |
| **Local Whisper** | nothing | free | Runs on your computer; ~300 MB model downloads on first use |
| **Platform captions** | nothing | free | Only when TikTok/Instagram provide them |

**No key is required for transcription**: local Whisper works out of the box. After the one-time model download, a short clip transcribes in a few seconds on an M1 MacBook; time grows with video length. Use `WHISPER_MODEL=Xenova/whisper-small` for better accuracy (slower) or `Xenova/whisper-base.en` for English-only content. Local Whisper assumes English unless you set `WHISPER_LANGUAGE` (e.g. `es`).

Force one option with `TRANSCRIPTION=openai|groq|local|captions|off`.

## Privacy and security

- **Your keys never leave your computer** except in requests to the provider they belong to. HookLab saves them only in `data/settings.json` (readable by your user account only) and never logs them or sends them back to the browser.
- Chats, transcripts, frames and settings are saved in `./data`, which is gitignored. Delete that folder to erase everything.
- The server listens on `127.0.0.1` only, so other devices on your network can't reach it. It also refuses requests from other websites open in your browser (cross-site and DNS-rebinding protection).
- Uploaded files are checked to be real MP4/MOV/WebM videos before ffmpeg touches them, and ffmpeg is restricted to reading that one file.
- Video content is sent to the AI model you pick. Don't analyze anything you aren't allowed to share with that provider.

## Troubleshooting

**"You are running the Intel build of Node.js on an Apple Silicon Mac"**: local Whisper needs the native (arm64) Node on M1/M2/M3/M4 Macs. Install Node from [nodejs.org](https://nodejs.org), then reinstall dependencies: `rm -rf node_modules && npm install`. Check with `node -p process.arch` (it should print `arm64`).

**Intel Macs**: local Whisper's speech engine has no Intel Mac build. Connect OpenAI, or add a free Groq key under **Settings → Transcription**.

**A link fails to download**: restart HookLab (it updates yt-dlp on start), or save the video and attach the file.

**"Port 8787 is used by another app"**: start with a different port, e.g. `PORT=8788 npm start`, or add `PORT=8788` to `.env`.

Run `npm run doctor` any time to check your setup.

## Development

```bash
npm run dev        # server + React app with hot reload on http://localhost:8787
npm run typecheck
```

- `server/`: Express API, video ingestion (`ingest.ts`), transcription (`transcribe.ts`), LLM adapters (`providers.ts`), prompts (`prompts.ts`), JSON file storage (`store.ts`), settings and Ollama setup (`settings.ts`), yt-dlp install (`tools.ts`)
- `client/`: React + TypeScript app (Vite)

## License and terms

Free and open source under the [MIT License](LICENSE). By using HookLab you agree to the [Terms of Use and License Agreement](TERMS.md), which the app asks you to accept on first launch. HookLab is provided as-is, with no warranty and no liability for the authors. You are responsible for your API usage and costs, and for following the terms of TikTok, Instagram and any content you analyze.

HookLab is not affiliated with or endorsed by TikTok, Instagram, Meta, Anthropic, OpenAI, Google or Groq.

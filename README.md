# StretchDvr

StretchDvr is a browser-based AVI to MP4 converter designed for DVR footage.

It supports:

- 4:3 preserve mode or true 16:9 stretch mode
- Keep or remove audio
- Batch queue processing
- Simple mode by default
- Advanced encoding controls inspired by cloud converters

## Privacy

All conversion processing runs client-side in the browser through WebAssembly.

- No file uploads
- No server-side video processing
- No account required

The FFmpeg core files are fetched as static assets for local execution. Your AVI and MP4 media data is processed on-device.

## Current Advanced Controls

- Video codec and encoder preset
- CRF or custom video bitrate
- FPS and keyframe interval
- Optional custom resolution and fit mode
- Audio codec, bitrate, channels, sample rate, and volume
- Optional trim start and trim end timestamps

## Local Development

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Lint:

```bash
npm run lint
```

## Browser Support

V1 is optimized for Chromium-based browsers (Chrome and Edge).

## Notes

- Very large files may use significant memory.
- Lower queue concurrency if your system becomes slow during conversion.
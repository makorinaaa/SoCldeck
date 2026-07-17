# Bundled FFmpeg

SocialDeck's Windows build uses FFmpeg 8.1.2 from the Gyan essentials build linked by the FFmpeg project.

Run `npm run ffmpeg:install:win` to download it. The installer pins both the release URL and SHA-256 digest. The executable is intentionally excluded from Git and is copied into packaged Windows builds as an external resource.

- Source release: https://github.com/FFmpeg/FFmpeg/tree/n8.1.2
- Windows build: https://github.com/GyanD/codexffmpeg/releases/tag/8.1.2
- License information: https://github.com/FFmpeg/FFmpeg/blob/n8.1.2/LICENSE.md

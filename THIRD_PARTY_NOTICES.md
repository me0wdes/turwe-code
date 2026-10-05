# OpenCode adaptations

Other bundled components retain their original licenses in node_modules inside the application package. Inter is distributed under the SIL Open Font License. Electron includes its Chromium and third-party license notices alongside the runtime. Mishanaer icon sources and local derivations are recorded in src/icons/source-manifest.json.

FFmpeg is distributed as a separate executable through ffmpeg-static 5.3.0 (binary release b6.1.1). Its platform-specific LICENSE and README are bundled beside that executable; these include the build configuration and corresponding source reference. Binary provenance: https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1. Windows source revision: https://github.com/FFmpeg/FFmpeg/commit/e38092ef93. FFmpeg and ffmpeg-static are licensed separately from the Turwe application; preserve their notices when redistributing.
Web search MCP request/response and edit line-ending normalization are adapted from https://github.com/anomalyco/opencode (dev snapshot 2026-10-04). Ported to CommonJS; bounds, permissions and transport integration are Turwe-specific.

Project environment and labelled instruction-source handling also follow OpenCode's `packages/opencode/src/session/system.ts` and `session/instruction.ts` (reviewed 2026-10-05). Turwe loads bounded project overview documents, respects its own read permissions and does not read parent or home directories automatically.

MIT License

Copyright (c) 2025 opencode

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


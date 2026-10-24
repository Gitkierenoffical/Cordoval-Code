# Third-party notices

Cordoval Code runs its own engine and does not bundle the OpenCode engine. Some user-interface
assets are derived from OpenCode (https://github.com/anomalyco/opencode, formerly sst/opencode):
the colour themes, the file-type icons and the choice of the Inter font, listed below. They are
used under the following licence:

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

Also bundled: Electron (MIT), xterm.js (MIT), marked (MIT), jsdiff (BSD-3-Clause), Monaco Editor (MIT),
Vercel AI SDK (Apache-2.0), Model Context Protocol SDK (MIT), node-pty (MIT), ws (MIT).

- Colour themes in src/renderer/themes-data.js are derived from OpenCode's desktop themes (packages/ui/src/theme/themes), MIT licence, Copyright (c) 2025 opencode.
- File icons (assets/file-icons.svg, src/renderer/file-icons.js) and the Inter font (assets/fonts/Inter.ttf, SIL Open Font Licence 1.1) come from OpenCode's packages/ui (MIT). Design tokens (type scale, radii, shadows) follow packages/ui/src/styles/theme.css.

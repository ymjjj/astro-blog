# 首页插画

## 当前版本：克制的黑白漫画（2026-09-27）

使用内置 imagegen（非 CLI）生成两幅独立插画。原稿为 `src/assets/manga-writer-original.png` 与 `src/assets/manga-cat-original.png`，均为 1536×1024。网页版本为 `public/media/manga-writer.webp`（960×640，48,884 bytes）、`manga-writer-small.webp`（480×320，16,122 bytes）、`manga-cat.webp`（960×640，33,152 bytes）、`manga-cat-small.webp`（480×320，9,138 bytes）。sharp 只进行尺寸与格式转换。旧稿保留，本轮未覆盖旧文件。插画仍属于 AI 生成。

写作者完整提示词：

> Use case: illustration-story. Asset type: small restrained illustration for a personal notes blog, landscape 3:2. Create an original Japanese black-and-white slice-of-life manga ink drawing. A short-haired young adult quietly writing in a notebook at a plain desk, with a small sleeping white cat beside the notebook; these are the established subjects of the blog. Medium framing, readable compact silhouette, abundant clean white negative space, just a few desk lines, no detailed room or landscape. Authentic economical pen strokes with varied line weight, modest natural facial expression, mostly white with a few deliberate solid black shapes in the hair and very sparse fine screentone. Everyday observational comic panel mood, understated and gently cute, no glossy anime rendering. Black ink and white only. No watercolor, gray airbrush shading, gradients, cinematic light, fake paper grain, decorative sparkles, text, captions, speech bubbles, border, signature or watermark. Actual artwork only, not a website mockup.

白猫完整提示词：

> Use case: illustration-story. Asset type: restrained supporting image for example notes in a personal blog, landscape 3:2. Original Japanese black-and-white slice-of-life manga drawing, a small white cat asleep with its chin resting beside a closed notebook and a single pencil on an otherwise empty desk. Only these few objects. Close quiet observational composition, generous unmarked white space around objects, central low silhouette occupying the middle third of the image. Economical varied black pen outlines, sparse manga hatching and minimal screentone shadow under the cat. Slightly imperfect natural pen strokes, quietly cute, no oversized eyes or cartoon effects. Pure black and white, clean white background, no color, watercolor, gradients, airbrush, realistic light, detailed background, decorative stars, symbols, text, lettering, speech bubbles, frame, signature or watermark. Actual illustration, not UI.

效果与验证见 [本轮视觉记录](../22-manga-style.md)。以下保留历次生成记录，不代表当前页面仍使用这些图。

## 手账风修订（2026-09-27）

根据用户对 AI 感过重的反馈，使用内置 imagegen 编辑原首页图。减少眼睛高光、密集材质、柔光和装饰，改用简洁线条、平涂与彩铅笔触，保留蓝发角色、白猫和蓝色系。此图仍为 AI 生成，不宣称人工绘制。旧稿保留，首页改用独立命名的新资源。

原稿：`src/assets/blue-notebook-sketch-original.png`；网页资源：`public/media/blue-notebook-sketch.webp`（1200×800，85,240 bytes）及 `blue-notebook-sketch-small.webp`（600×400，24,354 bytes）。sharp 仅用于缩放和 WebP 编码。

验证：静态构建成功；桌面 1440px 与手机 390px 的深浅主题均加载新图、无横向溢出、无页面脚本异常。结果见 [检查记录](../validation/sketch-visual.json)，效果见 [桌面](../screenshots/sketch-desktop-light.png) / [手机深色](../screenshots/sketch-mobile-dark.png)。本次仅替换首页插画，正文原有配图保留。

完整提示词：

> Use case: style-transfer. Edit target: supplied blog illustration. Redraw the scene from scratch as a restrained hand-drawn Japanese personal sketchbook illustration, landscape 3:2. Keep the recognizable short dusty-blue-haired writer, ivory cardigan, open notebook and sleepy white cat, gentle blue/ivory palette and quiet writing mood. Make the character a simplified young adult in a small diary comic: modest small dark eyes, two or three simple hair masses, a slightly off-center thoughtful expression looking down at the notebook. Natural relaxed seated pose with clearly readable simple hands holding a pencil. Cat curled on the desk beside notebook. Medium-wide composition with abundant blank warm ivory paper around the subject, simple blue rectangular window outline behind, cropped plain desk. Entire drawing only a handful of flat matte ink colors with slightly uneven thin slate-blue pen outlines and occasional sparse colored-pencil hatching. Intentional economical shapes, no rendering of individual hair strands or fabric knit, almost no shadows. Remove flowers, shelves, cushions, floating stars, ribbons, sparkles and blurred foreground. Avoid glossy anime eyes, airbrush gradients, volumetric sunlight, bokeh, 3D rendering, excessive watercolor bloom, ornate tiny objects, generic greeting-card finish, all-over fake paper noise. Quiet, personal, understated and cute through pose and silhouette. No text, signature or watermark. Actual illustration only.

## 第三阶段：窗边的小作家

新版主页使用内置 imagegen 新生成的原创插画。原稿保存在 `src/assets/blue-notebook-original.png`，网页版本为 `public/media/blue-notebook.webp`（1200×800，87,384 bytes）与 `blue-notebook-small.webp`（600×400，27,172 bytes）。使用 sharp 缩放和 WebP 编码，未用脚本重绘或改变画面。首页通过 srcset 选择版本，旧插画及已有正文图片保留。角色为虚构形象，不代表作者。

提示词：

> Use case: illustration-story. Create a polished original anime chibi illustration for a minimalist personal notes blog hero. Landscape 3:2. Soft powder blue, ivory white, a little pale peach, delicate hand drawn pencil lines and watercolor texture. A cute short blue-haired chibi young adult writer wearing an oversized cream cardigan with a small blue ribbon sits at a low desk writing in a notebook, with an adorable round white cat resting against a stack of books. Sunny window, little cloud outside, small vase, tiny four-point star sticker accents. Warm cozy everyday life, refined Japanese stationery illustration, charming expressive face, calm and gentle not loud. Composition keep subjects centered with generous pale blue-white negative space around edges, clear readable silhouette, no busy background. No text, letters, logo or watermark. This is an actual illustration asset, not a website mockup.

## 第一阶段原插画

使用内置 imagegen 工具生成，无外部 API key。原图保存在 `assets/source/window-notes.png`，页面使用 `public/media/window-notes.webp`（1200×800 WebP）。压缩使用 sharp，只做尺寸与格式转换，不改变构图。插画是虚构角色，不代表博客作者。

## 完整提示词

Use case: illustration-story. Asset type: original anime illustration for a quiet personal notes blog, landscape 3:2 image. A peaceful afternoon by an open window, a young adult woman with short dark blue hair wearing an ivory cardigan seated at a wooden desk, thoughtfully writing in an open notebook, small white cat curled up on the windowsill, distant coastal town rooftops and soft clouds visible outside, a tiny potted plant and a glass of water. Tasteful contemporary Japanese animation background painting, delicate pencil outlines, soft watercolor texture, muted sky blue, warm ivory and sage greens, sunlight and subtle moving curtain, intimate calm composition, elegant editorial quality, not chibi. Entire image a complete illustration, no UI, no lettering, no logo, no watermark. Landscape framing, readable at small size, main character on right half, airy window and sky on left. Avoid excessive decorative elements and neon.

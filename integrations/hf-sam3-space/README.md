---
title: mozAI SAM 3 Wand
emoji: 🎨
colorFrom: purple
colorTo: green
sdk: gradio
sdk_version: 6.0.0
python_version: 3.12
app_file: app.py
pinned: false
---

# mozAI SAM 3 ZeroGPU Space

This is a **template**, not a deployed Space. Copy these files to a Hugging Face
Gradio Space, select **ZeroGPU** hardware in Space settings, accept the Meta SAM 3
checkpoint agreement with your Hugging Face account, and set a secret HF_TOKEN
with authorized access to the gated checkpoint.

See ../../docs/sam3-wand.md for mozAI/Vercel configuration, quota and privacy notes.

The Gradio endpoint is named segment and accepts:
1. JPEG data URI (max 1024px / 2.5MB encoded)
2. integer click X in sample pixels
3. integer click Y in sample pixels

It returns a transparent white-selected PNG as a data URI. The endpoint is
intentionally compatible with mozAI's /api/ai/sam3 same-origin proxy.

Checkpoint download, CUDA compatibility and startup performance require
validation against the selected ZeroGPU runtime before enabling for users.

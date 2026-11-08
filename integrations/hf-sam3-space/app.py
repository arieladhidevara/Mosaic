"""Gradio ZeroGPU SAM 3 click-to-mask Space for mozAI.

Contract:
  POST /gradio_api/call/segment {"data":[jpeg_data_uri, x, y]}
  Returns a text data URI PNG mask; transparent background, opaque white selection.
Requires accepted Meta SAM 3 checkpoint access and HF_TOKEN as a Space secret.
"""
import base64
import io

import gradio as gr
import numpy as np
import spaces
import torch
from PIL import Image
from sam3.model_builder import build_sam3_image_model
from sam3.model.sam3_image_processor import Sam3Processor

# ZeroGPU requires GPU models to be created at module import time.
model = build_sam3_image_model(enable_inst_interactivity=True)
processor = Sam3Processor(model)


@spaces.GPU(duration=45)
def segment(image_data_uri: str, x: int, y: int) -> str:
    if not isinstance(image_data_uri, str) or not image_data_uri.startswith("data:image/jpeg;base64,"):
        raise gr.Error("Expected JPEG data URI.")
    if len(image_data_uri) > 2_500_000:
        raise gr.Error("Image too large.")
    try:
        image_bytes = base64.b64decode(image_data_uri.split(",", 1)[1], validate=True)
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        w, h = image.size
        x, y = int(x), int(y)
        if not (1 <= w <= 1024 and 1 <= h <= 1024 and 0 <= x < w and 0 <= y < h):
            raise ValueError("Coordinates or image size out of bounds.")
        with torch.inference_mode():
            state = processor.set_image(image)
            masks, scores, _ = model.predict_inst(
                state,
                point_coords=np.asarray([[x, y]], dtype=np.float32),
                point_labels=np.asarray([1], dtype=np.int32),
                multimask_output=True,
            )
        idx = int(np.argmax(scores))
        binary = np.asarray(masks[idx]).astype(bool)
        if binary.shape != (h, w):
            raise ValueError("Unexpected SAM 3 mask shape.")
        rgba = np.full((h, w, 4), 255, dtype=np.uint8)
        rgba[:, :, 3] = binary.astype(np.uint8) * 255
        out = io.BytesIO()
        Image.fromarray(rgba, mode="RGBA").save(out, format="PNG")
        return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode("ascii")
    except (ValueError, OSError, IndexError) as exc:
        raise gr.Error("SAM 3 could not create a mask for this image.") from exc


demo = gr.Interface(
    fn=segment,
    inputs=[
        gr.Textbox(label="JPEG data URI", lines=2),
        gr.Number(label="Click X", precision=0),
        gr.Number(label="Click Y", precision=0),
    ],
    outputs=gr.Textbox(label="Transparent PNG mask data URI"),
    api_name="segment",
    title="mozAI SAM 3 Smart Wand",
    description="Input a JPEG data URI and pixel position. This is a private API integration contract, not a public image gallery.",
)
demo.queue().launch()

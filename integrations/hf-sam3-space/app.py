"""Gradio ZeroGPU SAM 3 click-to-mask Space for mozAI.

Contract:
  POST /gradio_api/call/segment {"data":[jpeg_data_uri, x, y]}
  Returns a text data URI PNG mask; transparent background, opaque white selection.
Requires accepted Meta SAM 3 checkpoint access and HF_TOKEN as a Space secret.
"""
import base64
import io
import json
from functools import lru_cache

# ZeroGPU patches PyTorch; import it before Gradio or SAM 3.
import spaces
import gradio as gr
import numpy as np
import torch
from PIL import Image
from auto_regions import build_label_map
from mask_utils import choose_clicked_mask
from object_masks import choose_object_mask
from sam3.model_builder import build_sam3_image_model
from sam3.model.sam3_image_processor import Sam3Processor

# Meta SAM 3 constructs mixed CPU and hardcoded-CUDA tensors while deep-
# copying transformer layers. Even forcing the default CPU device cannot
# protect module-scope model construction from ZeroGPU's fake-CUDA patch.
# Construct on the actual allocated GPU *inside* the decorated handler.
# Warm GPU workers cache the model; cold workers incur checkpoint load cost.
@lru_cache(maxsize=1)
def gpu_model():
    model = build_sam3_image_model(enable_inst_interactivity=True, device="cuda")
    model.eval()
    return model, Sam3Processor(model)


@spaces.GPU(duration=120)
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
        model, processor = gpu_model()
        with torch.inference_mode():
            state = processor.set_image(image)
            masks, scores, _ = model.predict_inst(
                state,
                point_coords=np.asarray([[x, y]], dtype=np.float32),
                point_labels=np.asarray([1], dtype=np.int32),
                multimask_output=True,
            )
        # Prefer a click-containing object over a high-score whole-image mask.
        # Drop disconnected islands and reject nearly full-canvas selections.
        binary = choose_clicked_mask(masks, scores, x, y)
        if binary.shape != (h, w):
            raise ValueError("Unexpected SAM 3 mask shape.")
        rgba = np.full((h, w, 4), 255, dtype=np.uint8)
        rgba[:, :, 3] = binary.astype(np.uint8) * 255
        out = io.BytesIO()
        Image.fromarray(rgba, mode="RGBA").save(out, format="PNG")
        return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode("ascii")
    except (ValueError, OSError, IndexError) as exc:
        raise gr.Error("SAM 3 could not isolate that object. Click farther inside its outline or use Color Wand.") from exc


@spaces.GPU(duration=120)
def segment_all(image_data_uri: str) -> str:
    """Return one grayscale PNG index map for all detected object proposals."""
    if not isinstance(image_data_uri, str) or not image_data_uri.startswith("data:image/jpeg;base64,"):
        raise gr.Error("Expected JPEG data URI.")
    if len(image_data_uri) > 2_500_000:
        raise gr.Error("Image too large.")
    try:
        payload = base64.b64decode(image_data_uri.split(",", 1)[1], validate=True)
        image = Image.open(io.BytesIO(payload)).convert("RGB")
        w, h = image.size
        if not (1 <= w <= 1024 and 1 <= h <= 1024):
            raise ValueError("Unsupported image dimensions.")

        model, processor = gpu_model()
        # Encode the image once. Reuse SAM 3's image features for grid prompts.
        with torch.inference_mode():
            image_state = processor.set_image(image)

            def predict_at(px, py):
                masks, scores, _ = model.predict_inst(
                    image_state,
                    point_coords=np.asarray([[px, py]], dtype=np.float32),
                    point_labels=np.asarray([1], dtype=np.int32),
                    multimask_output=True,
                )
                return masks, scores

            label_map = build_label_map(w, h, predict_at)
        result = io.BytesIO()
        Image.fromarray(label_map, mode="L").save(result, format="PNG")
        data_uri = "data:image/png;base64," + base64.b64encode(result.getvalue()).decode("ascii")
        return json.dumps({"labels": data_uri, "count": int(np.max(label_map))})
    except (ValueError, OSError, IndexError) as exc:
        raise gr.Error("Auto Create could not find distinct objects. Try a clearer render or use Color Wand.") from exc


@spaces.GPU(duration=120)
def segment_object(image_data_uri: str, label: str, left: float, top: float, right: float, bottom: float) -> str:
    if not isinstance(image_data_uri, str) or not image_data_uri.startswith("data:image/jpeg;base64,") or len(image_data_uri) > 2_500_000:
        raise gr.Error("Expected a small JPEG data URI.")
    if not isinstance(label, str) or not label.strip() or len(label) > 80:
        raise gr.Error("Expected an object label.")
    try:
        image = Image.open(io.BytesIO(base64.b64decode(image_data_uri.split(",", 1)[1], validate=True))).convert("RGB")
        w, h = image.size
        if not (1 <= w <= 1024 and 1 <= h <= 1024 and 0 <= left < right <= w and 0 <= top < bottom <= h):
            raise ValueError("Invalid object region.")
        _, processor = gpu_model()
        with torch.inference_mode():
            state = processor.set_image(image)
            processor.set_text_prompt(label.strip(), state)
            result = processor.add_geometric_prompt([(left+right)/2/w, (top+bottom)/2/h, (right-left)/w, (bottom-top)/h], True, state)
        binary = choose_object_mask(result["masks"].detach().cpu().numpy(), result["scores"].detach().cpu().numpy(), (left, top, right, bottom))
        rgba = np.full((h, w, 4), 255, dtype=np.uint8)
        rgba[:, :, 3] = binary.astype(np.uint8) * 255
        out = io.BytesIO()
        Image.fromarray(rgba, mode="RGBA").save(out, format="PNG")
        return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode("ascii")
    except (ValueError, OSError, IndexError) as exc:
        raise gr.Error("No reliable object mask.") from exc


# All endpoints share an inference model and must not mutate its state concurrently.
with gr.Blocks(title="mozAI SAM 3") as demo:
    gr.Markdown("## mozAI SAM 3 — segmentation service")
    gr.Markdown("Create individual 2D masks or detect a set of candidate objects.")
    source = gr.Textbox(label="JPEG data URI", lines=2)
    with gr.Row():
        x_input = gr.Number(label="Click X", precision=0)
        y_input = gr.Number(label="Click Y", precision=0)
    click_result = gr.Textbox(label="Selected PNG mask")
    auto_result = gr.Textbox(label="Grayscale object-index PNG JSON")
    object_label = gr.Textbox(label="Object label")
    object_box = [gr.Number(label=name) for name in ("Left", "Top", "Right", "Bottom")]
    gr.Button("Select described object").click(
        fn=segment_object, inputs=[source, object_label, *object_box], outputs=[click_result],
        api_name="segment_object", concurrency_id="sam3-inference", concurrency_limit=1,
    )
    gr.Button("Select clicked object").click(
        fn=segment, inputs=[source, x_input, y_input], outputs=[click_result],
        api_name="segment", concurrency_id="sam3-inference", concurrency_limit=1,
    )
    gr.Button("Auto detect candidate objects").click(
        fn=segment_all, inputs=[source], outputs=[auto_result],
        api_name="segment_all", concurrency_id="sam3-inference", concurrency_limit=1,
    )

demo.queue().launch()

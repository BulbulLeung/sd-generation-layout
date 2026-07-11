import os
import sys

from modules import errors, scripts

_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

try:
    import hardware_stats  # noqa: F401 — registers on_app_started routes
except Exception:
    errors.report(
        "sd-generation-layout: hardware_stats load failed",
        exc_info=True,
    )


class SdGenerationLayoutExt(scripts.Script):
    """Registers GPU stats API; layout is handled by javascript."""

    def title(self):
        return "sd-generation-layout"

    def show(self, is_img2img):
        return False

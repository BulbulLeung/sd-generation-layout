from modules import errors, scripts

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

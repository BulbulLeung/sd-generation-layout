import re
import subprocess
from typing import Any

import gradio as gr
from fastapi import FastAPI

from modules import script_callbacks, shared

_PYNVML = None
_PYNVML_INIT = False


def _get_active_gpu_index() -> int:
    device = shared.device or ""
    match = re.search(r":(\d+)$", str(device))
    if match:
        return int(match.group(1))
    if device.startswith("cuda"):
        return 0
    return 0


def _safe_float(value: Any, default: float | None = None) -> float | None:
    if value is None:
        return default
    try:
        text = str(value).strip().replace(",", ".")
        if not text or text.upper() in {"N/A", "[N/A]", "NA", "NONE"}:
            return default
        return float(text)
    except (TypeError, ValueError):
        return default


def _safe_int(value: Any, default: int | None = None) -> int | None:
    parsed = _safe_float(value, None)
    if parsed is None:
        return default
    return int(round(parsed))


def _gb_from_mib(mib: float | None) -> float | None:
    if mib is None:
        return None
    return round(mib / 1024, 1)


def _init_pynvml() -> bool:
    global _PYNVML, _PYNVML_INIT
    if _PYNVML_INIT:
        return _PYNVML is not None
    _PYNVML_INIT = True
    try:
        import pynvml

        pynvml.nvmlInit()
        _PYNVML = pynvml
        return True
    except Exception:
        _PYNVML = None
        return False


def _collect_with_pynvml() -> list[dict[str, Any]] | None:
    if not _init_pynvml():
        return None

    gpus: list[dict[str, Any]] = []
    try:
        count = _PYNVML.nvmlDeviceGetCount()
        for index in range(count):
            handle = _PYNVML.nvmlDeviceGetHandleByIndex(index)
            name = _PYNVML.nvmlDeviceGetName(handle)
            if isinstance(name, bytes):
                name = name.decode("utf-8", errors="replace")

            temperature_c = None
            try:
                temperature_c = int(_PYNVML.nvmlDeviceGetTemperature(handle, _PYNVML.NVML_TEMPERATURE_GPU))
            except Exception:
                pass

            fan_speed_pct = None
            try:
                fan_speed_pct = int(_PYNVML.nvmlDeviceGetFanSpeed(handle))
            except Exception:
                pass

            gpu_util_pct = None
            try:
                util = _PYNVML.nvmlDeviceGetUtilizationRates(handle)
                gpu_util_pct = int(util.gpu)
            except Exception:
                pass

            memory_used_gb = None
            memory_total_gb = None
            memory_pct = None
            try:
                mem = _PYNVML.nvmlDeviceGetMemoryInfo(handle)
                memory_used_gb = round(mem.used / (1024 ** 3), 1)
                memory_total_gb = round(mem.total / (1024 ** 3), 1)
                if mem.total > 0:
                    memory_pct = round(mem.used / mem.total * 100, 1)
            except Exception:
                pass

            clock_mhz = None
            try:
                clock_mhz = int(_PYNVML.nvmlDeviceGetClockInfo(handle, _PYNVML.NVML_CLOCK_GRAPHICS))
            except Exception:
                pass

            power_draw_w = None
            power_limit_w = None
            try:
                power_draw_w = round(_PYNVML.nvmlDeviceGetPowerUsage(handle) / 1000, 1)
            except Exception:
                pass
            try:
                power_limit_w = round(_PYNVML.nvmlDeviceGetEnforcedPowerLimit(handle) / 1000, 1)
            except Exception:
                pass

            gpus.append({
                "index": index,
                "name": name,
                "temperature_c": temperature_c,
                "fan_speed_pct": fan_speed_pct,
                "gpu_util_pct": gpu_util_pct,
                "memory_used_gb": memory_used_gb,
                "memory_total_gb": memory_total_gb,
                "memory_pct": memory_pct,
                "clock_mhz": clock_mhz,
                "power_draw_w": power_draw_w,
                "power_limit_w": power_limit_w,
            })
        return gpus
    except Exception:
        return None


def _collect_with_nvidia_smi() -> list[dict[str, Any]] | None:
    query = (
        "index,name,temperature.gpu,fan.speed,utilization.gpu,"
        "memory.used,memory.total,clocks.current.graphics,power.draw,power.limit"
    )
    try:
        out = subprocess.check_output(
            ["nvidia-smi", f"--query-gpu={query}", "--format=csv,noheader,nounits"],
            stderr=subprocess.DEVNULL,
            timeout=5,
        )
    except Exception:
        return None

    gpus: list[dict[str, Any]] = []
    for line in out.decode("utf-8", errors="replace").strip().splitlines():
        parts = [part.strip() for part in line.split(",")]
        if len(parts) < 10:
            continue

        index = _safe_int(parts[0], 0) or 0
        name = parts[1]
        temperature_c = _safe_int(parts[2])
        fan_speed_pct = _safe_int(parts[3])
        gpu_util_pct = _safe_int(parts[4])
        memory_used_gb = _gb_from_mib(_safe_float(parts[5]))
        memory_total_gb = _gb_from_mib(_safe_float(parts[6]))
        memory_pct = None
        if memory_used_gb is not None and memory_total_gb and memory_total_gb > 0:
            memory_pct = round(memory_used_gb / memory_total_gb * 100, 1)
        clock_mhz = _safe_int(parts[7])
        power_draw_w = _safe_float(parts[8])
        power_limit_w = _safe_float(parts[9])

        gpus.append({
            "index": index,
            "name": name,
            "temperature_c": temperature_c,
            "fan_speed_pct": fan_speed_pct,
            "gpu_util_pct": gpu_util_pct,
            "memory_used_gb": memory_used_gb,
            "memory_total_gb": memory_total_gb,
            "memory_pct": memory_pct,
            "clock_mhz": clock_mhz,
            "power_draw_w": power_draw_w,
            "power_limit_w": power_limit_w,
        })

    return gpus or None


def collect_gpu_stats() -> dict[str, Any]:
    gpus = _collect_with_pynvml()
    if not gpus:
        gpus = _collect_with_nvidia_smi()

    if not gpus:
        return {"available": False, "gpus": [], "active_index": _get_active_gpu_index()}

    active_index = _get_active_gpu_index()
    if not any(gpu["index"] == active_index for gpu in gpus):
        active_index = gpus[0]["index"]

    return {
        "available": True,
        "gpus": gpus,
        "active_index": active_index,
    }


def register_gpu_stats_routes(_: gr.Blocks, app: FastAPI):
    @app.get("/sd-gen-layout/gpu-stats")
    async def gpu_stats():
        return collect_gpu_stats()


script_callbacks.on_app_started(
    register_gpu_stats_routes,
    name="sd-generation-layout-gpu-stats",
)

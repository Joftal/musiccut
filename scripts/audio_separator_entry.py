#!/usr/bin/env python3
"""audio-separator entry point with DirectML GPU acceleration support.

audio-separator's CLI does not expose the use_directml parameter, and
torch-directml is incompatible with the torch version we use. However,
for ONNX models (MDX-Net), the actual inference uses ONNX Runtime, not
PyTorch. So we monkey-patch the Separator's setup_torch_device method
to directly set DmlExecutionProvider when available in ONNX Runtime,
bypassing the torch.cuda / torch-directml checks.
"""
import sys
import os


def check_gpu():
    """Check ONNX Runtime DirectML GPU availability and print result."""
    try:
        import onnxruntime as ort
        providers = ort.get_available_providers()
        has_gpu = (
            'DmlExecutionProvider' in providers
            or 'CUDAExecutionProvider' in providers
        )
        print('onnx_gpu_ok' if has_gpu else 'onnx_gpu_no')
    except Exception:
        print('onnx_gpu_no')


def _patch_separator_for_directml():
    """Monkey-patch Separator to use DmlExecutionProvider for ONNX models.

    audio-separator checks torch.cuda.is_available() or torch-directml
    to decide GPU usage, but for ONNX models (MDX-Net), inference is done
    via ONNX Runtime. We patch setup_torch_device to set DmlExecutionProvider
    directly when it's available in onnxruntime, regardless of PyTorch's
    GPU support.
    """
    # Respect forced CPU mode from MusicCut
    if os.environ.get("MUSICCUT_FORCE_CPU") == "1":
        return

    import onnxruntime as ort
    providers = ort.get_available_providers()
    has_dml = 'DmlExecutionProvider' in providers
    has_cuda = 'CUDAExecutionProvider' in providers

    if not has_dml and not has_cuda:
        return  # No GPU provider available, let original logic handle it

    from audio_separator.separator.separator import Separator
    _original_setup = Separator.setup_torch_device

    def _patched_setup(self, system_info):
        _original_setup(self, system_info)
        # If original setup already found GPU (e.g. CUDA), don't override
        if self.onnx_execution_provider and self.onnx_execution_provider != ["CPUExecutionProvider"]:
            return
        # Force DML or CUDA provider for ONNX Runtime, with CPU fallback
        if has_cuda:
            self.onnx_execution_provider = ["CUDAExecutionProvider", "CPUExecutionProvider"]
            self.logger.info("Patched: Using CUDAExecutionProvider for ONNX Runtime (CPU fallback enabled)")
        elif has_dml:
            self.onnx_execution_provider = ["DmlExecutionProvider", "CPUExecutionProvider"]
            self.logger.info("Patched: Using DmlExecutionProvider for ONNX Runtime (CPU fallback enabled)")

    Separator.setup_torch_device = _patched_setup


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--check-gpu':
        check_gpu()
        sys.exit(0)
    _patch_separator_for_directml()
    from audio_separator.utils.cli import main
    sys.exit(main())

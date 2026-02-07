#!/usr/bin/env python3
"""audio-separator entry point with GPU acceleration support.

audio-separator's CLI does not expose GPU provider selection directly.
For ONNX models (MDX-Net), the actual inference uses ONNX Runtime, not
PyTorch. We monkey-patch the Separator's setup_torch_device method to
set the best verified GPU provider (CUDA > DirectML > CPU) in ONNX
Runtime, bypassing the torch.cuda / torch-directml checks.

Key design: all GPU checks actually create an ONNX InferenceSession
and run inference to verify the provider truly works, rather than just
checking get_available_providers() which can report providers whose
runtime dependencies (cuDNN, CUDA toolkit) are missing.
"""
import sys
import os


def _verify_gpu_provider(provider_name):
    """Verify a GPU provider actually works by creating a real ONNX session.

    Simply checking get_available_providers() is unreliable — a provider can
    appear in the list even when the required runtime libraries (cuDNN, CUDA
    toolkit) are missing or version-mismatched.

    Returns True only if the provider can successfully run inference.
    """
    try:
        import tempfile
        import onnxruntime as ort
        import numpy as np
        import onnx
        from onnx import helper, TensorProto

        X = helper.make_tensor_value_info('X', TensorProto.FLOAT, [1, 2])
        Y = helper.make_tensor_value_info('Y', TensorProto.FLOAT, [1, 2])
        node = helper.make_node('Identity', ['X'], ['Y'])
        graph = helper.make_graph([node], 'test', [X], [Y])
        model = helper.make_model(graph, opset_imports=[helper.make_opsetid('', 13)])

        tmp_path = os.path.join(tempfile.gettempdir(), '_musiccut_gpu_verify.onnx')
        onnx.save(model, tmp_path)

        try:
            sess = ort.InferenceSession(
                tmp_path,
                providers=[provider_name, 'CPUExecutionProvider'],
            )
            active = [p for p in sess.get_providers() if p != 'CPUExecutionProvider']
            if active:
                sess.run(None, {'X': np.array([[1.0, 2.0]], dtype=np.float32)})
                return True
            return False
        finally:
            try:
                os.remove(tmp_path)
            except OSError:
                pass
    except Exception:
        return False


def check_gpu():
    """Check ONNX Runtime GPU availability and print result.

    Tests CUDA first, then DML. Prints 'onnx_gpu_ok' only if a GPU
    provider can actually run inference successfully.
    """
    try:
        import onnxruntime as ort
        providers = ort.get_available_providers()

        # Test CUDA first, then DML
        for provider in ('CUDAExecutionProvider', 'DmlExecutionProvider'):
            if provider in providers and _verify_gpu_provider(provider):
                print('onnx_gpu_ok')
                return

        print('onnx_gpu_no')
    except Exception as e:
        print(f'onnx_gpu_no:{e}', file=sys.stderr)
        print('onnx_gpu_no')


def _patch_separator_for_gpu():
    """Monkey-patch Separator to use the best available GPU provider.

    audio-separator checks torch.cuda.is_available() or torch-directml
    to decide GPU usage, but for ONNX models (MDX-Net), inference is done
    via ONNX Runtime. We patch setup_torch_device to set the GPU provider
    directly when it's verified working in onnxruntime, regardless of
    PyTorch's GPU support.

    Key improvement: we actually *verify* the provider works by creating
    a test session, rather than just checking get_available_providers().
    This prevents the case where CUDAExecutionProvider is listed but
    fails at runtime due to missing cuDNN/CUDA libraries.
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

    # Determine which provider actually works (verify with real session)
    verified_provider = None
    if has_cuda and _verify_gpu_provider('CUDAExecutionProvider'):
        verified_provider = 'CUDAExecutionProvider'
    elif has_dml and _verify_gpu_provider('DmlExecutionProvider'):
        verified_provider = 'DmlExecutionProvider'

    if verified_provider is None:
        import logging
        logging.getLogger('audio_separator_entry').warning(
            "GPU providers listed but none actually work. "
            "CUDA needs cuDNN 9.x + CUDA 12.x. Falling back to CPU."
        )
        return

    from audio_separator.separator.separator import Separator
    _original_setup = Separator.setup_torch_device

    def _patched_setup(self, system_info):
        _original_setup(self, system_info)
        # If original setup already found a working GPU provider, keep it
        if (self.onnx_execution_provider
                and self.onnx_execution_provider != ["CPUExecutionProvider"]):
            return
        # Use the verified GPU provider
        self.onnx_execution_provider = [verified_provider, "CPUExecutionProvider"]
        self.logger.info(
            f"Patched: Using {verified_provider} for ONNX Runtime "
            f"(verified working, CPU fallback enabled)"
        )

    Separator.setup_torch_device = _patched_setup


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--check-gpu':
        check_gpu()
        sys.exit(0)
    _patch_separator_for_gpu()
    from audio_separator.utils.cli import main
    sys.exit(main())

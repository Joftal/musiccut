#!/usr/bin/env python3
"""audio-separator entry point"""
import sys

def check_gpu():
    """Check ONNX Runtime GPU availability and print result."""
    try:
        import onnxruntime as ort
        providers = ort.get_available_providers()
        has_gpu = (
            'CUDAExecutionProvider' in providers
            or 'TensorrtExecutionProvider' in providers
            or 'DmlExecutionProvider' in providers
        )
        print('onnx_gpu_ok' if has_gpu else 'onnx_gpu_no')
    except Exception:
        print('onnx_gpu_no')

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--check-gpu':
        check_gpu()
        sys.exit(0)
    from audio_separator.separator import main
    sys.exit(main())

// 音频处理模块
//
// 子模块：
// - separator: 人声/伴奏分离（调用 audio-separator，基于 MDX-Net ONNX 模型）
// - fingerprint: 音频指纹提取与相似度比较（调用 fpcalc，基于 Chromaprint）

pub mod fingerprint;
pub mod separator;

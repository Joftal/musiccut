// 人物检测模块
//
// 基于 YOLOv11s 模型对视频逐帧检测人物，将连续检测帧合并为时间片段。
// 与人声分离 pipeline 完全独立运行：独立的 GPU 信号量、取消标志、事件通道。
//
// 子模块：
// - detector: 核心检测逻辑，负责启动 person-detector 子进程、解析进度、读取结果

pub mod detector;

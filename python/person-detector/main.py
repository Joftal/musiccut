#!/usr/bin/env python3
"""
人物检测脚本 - 使用 YOLOv11s 模型检测视频中的人物
输出 JSON 结果，通过 stderr 输出 tqdm 进度条
"""

import argparse
import json
import sys
import os

import cv2
from ultralytics import YOLO
from tqdm import tqdm


def merge_segments(detections, fps, frame_interval, max_gap_duration, min_segment_duration):
    """将检测到人物的帧合并为连续时间段"""
    if not detections:
        return []

    # detections: list of (frame_index, confidence)
    detections.sort(key=lambda x: x[0])

    segments = []
    seg_start_frame = detections[0][0]
    seg_end_frame = detections[0][0]
    seg_max_conf = detections[0][1]

    max_gap_frames = max_gap_duration * fps

    for frame_idx, conf in detections[1:]:
        gap = frame_idx - seg_end_frame
        if gap <= max_gap_frames:
            seg_end_frame = frame_idx
            seg_max_conf = max(seg_max_conf, conf)
        else:
            start_t = seg_start_frame / fps
            end_t = (seg_end_frame + frame_interval) / fps
            if end_t - start_t >= min_segment_duration:
                segments.append({
                    "start_time": round(start_t, 3),
                    "end_time": round(end_t, 3),
                    "confidence": round(seg_max_conf, 4),
                })
            seg_start_frame = frame_idx
            seg_end_frame = frame_idx
            seg_max_conf = conf

    # 最后一段
    start_t = seg_start_frame / fps
    end_t = (seg_end_frame + frame_interval) / fps
    if end_t - start_t >= min_segment_duration:
        segments.append({
            "start_time": round(start_t, 3),
            "end_time": round(end_t, 3),
            "confidence": round(seg_max_conf, 4),
        })

    return segments


def detect_persons(
    video_path: str,
    model_path: str,
    output_json: str,
    confidence: float = 0.5,
    frame_interval: int = 5,
    device: str = "auto",
    max_gap_duration: float = 2.0,
    min_segment_duration: float = 1.0,
):
    """主检测函数"""
    # 确定设备
    if device == "auto":
        import torch
        dev = "cuda" if torch.cuda.is_available() else "cpu"
    elif device == "gpu":
        dev = "cuda"
    else:
        dev = "cpu"

    print(f"Using device: {dev}", file=sys.stderr)

    # 加载模型
    model = YOLO(model_path)

    # 打开视频
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"ERROR: Cannot open video: {video_path}", file=sys.stderr)
        sys.exit(1)

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    frames_to_process = list(range(0, total_frames, frame_interval))

    print(f"Video: {total_frames} frames, {fps:.2f} fps", file=sys.stderr)
    print(f"Processing {len(frames_to_process)} frames (interval={frame_interval})", file=sys.stderr)

    detections = []
    detection_frame_count = 0

    pbar = tqdm(total=len(frames_to_process), desc="Detecting", file=sys.stderr, ncols=80)

    for frame_idx in frames_to_process:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        if not ret:
            pbar.update(1)
            continue

        # 使用 ultralytics 推理，只检测 person (class 0)
        results = model.predict(
            frame, conf=confidence, classes=[0],
            device=dev, verbose=False,
        )

        # 检查是否检测到人物
        if len(results) > 0 and len(results[0].boxes) > 0:
            max_conf = float(results[0].boxes.conf.max())
            detections.append((frame_idx, max_conf))
            detection_frame_count += 1

        pbar.update(1)

    pbar.close()
    cap.release()

    # 合并为时间段
    segments = merge_segments(
        detections, fps, frame_interval, max_gap_duration, min_segment_duration
    )

    result = {
        "segments": segments,
        "total_frames": total_frames,
        "processed_frames": len(frames_to_process),
        "detection_frames": detection_frame_count,
    }

    # 写入 JSON
    os.makedirs(os.path.dirname(os.path.abspath(output_json)), exist_ok=True)
    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"Detection complete: {len(segments)} segments found", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="Person detection in video using YOLO")
    parser.add_argument("--video_path", required=True, help="Input video path")
    parser.add_argument("--model_path", required=True, help="Model path (.pt)")
    parser.add_argument("--output_json", required=True, help="Output JSON path")
    parser.add_argument("--confidence", type=float, default=0.5)
    parser.add_argument("--frame_interval", type=int, default=5)
    parser.add_argument("--device", choices=["auto", "cpu", "gpu"], default="auto")
    parser.add_argument("--max_gap_duration", type=float, default=2.0)
    parser.add_argument("--min_segment_duration", type=float, default=1.0)
    args = parser.parse_args()

    detect_persons(
        video_path=args.video_path,
        model_path=args.model_path,
        output_json=args.output_json,
        confidence=args.confidence,
        frame_interval=args.frame_interval,
        device=args.device,
        max_gap_duration=args.max_gap_duration,
        min_segment_duration=args.min_segment_duration,
    )


if __name__ == "__main__":
    main()
